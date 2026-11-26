import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Button from '../components/Button';
import StandingsTable from '../components/StandingsTable';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { useI18n } from '../i18n';
import { apiFetch } from '../lib/api';
import { initialMatchday, isRecordedScore, matchdaySections, parseScore, parseTeamList } from '../lib/leagueManager.js';
import './leagueManager.css';

const BASE = '/league-manager';
const CLEARED_SCORE = { home_goals: null, away_goals: null };
const ERROR_KEYS = {
  account_already_signed_in: 'alreadySignedIn',
  account_login_invalid: 'loginFailed',
  account_rate_limited: 'rateLimited',
  account_registration_invalid: 'registrationFailed',
  duplicate_teams: 'duplicateTeams',
  invalid_league: 'invalidName',
  invalid_teams: 'invalidTeams',
  invalid_score: 'invalidScore',
  roster_locked: 'rosterLocked',
};

function request(path, method, data) {
  return apiFetch(BASE + path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
}

function useRead(path) {
  const [operation, setOperation] = useState({ path: null, status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController();
    setOperation({ path, status: 'loading' });
    apiFetch(BASE + path, { signal: controller.signal }).then(
      (value) => {
        if (!controller.signal.aborted) setOperation({ path, status: 'ready', value });
      },
      (error) => {
        if (!controller.signal.aborted) setOperation({ path, status: 'error', error });
      },
    );
    return () => controller.abort();
  }, [path, attempt]);
  return {
    ...(operation.path === path ? operation : { status: 'loading' }),
    retry: () => setAttempt((value) => value + 1),
    setValue: (value) => setOperation({ path, status: 'ready', value }),
  };
}

function useAction() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(action, fallbackKey) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setError({ ...failure, fallbackKey });
      return false;
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }

  return { busy, error, run, clear: () => setError(null) };
}

function ManagerError({ error, action, fallback = 'loadFailed', onRetry }) {
  const { t } = useI18n();
  const key = action || ERROR_KEYS[error?.code] || error?.fallbackKey || fallback;
  return <ErrorState title={t(`leagueManager.${key}`)} onRetry={onRetry} />;
}

function AccountForm({ onAuthenticated }) {
  const { t } = useI18n();
  const [registering, setRegistering] = useState(false);
  const action = useAction();
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const credentials = { username: String(form.get('username')).trim(), password: String(form.get('password')) };
    const path = registering ? 'register' : 'login';
    await action.run(async () => {
      const account = await request(`/account/${path}/`, 'POST', credentials);
      onAuthenticated(account);
    }, registering ? 'registrationFailed' : 'loginFailed');
  }

  return (
    <div className="lm-panel lm-account">
      <h2>{t(registering ? 'leagueManager.register' : 'leagueManager.signIn')}</h2>
      <p>{t('leagueManager.ownerAccess')}</p>
      {action.error && <ManagerError error={action.error} />}
      <form className="lm-form" onSubmit={submit}>
        <label>
          {t('leagueManager.username')}
          <input name="username" autoComplete="username" required maxLength={150} readOnly={action.busy} />
        </label>
        <label>
          {t('leagueManager.password')}
          <input
            type="password"
            name="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            minLength={registering ? 8 : undefined}
            maxLength={128}
            readOnly={action.busy}
            required
          />
        </label>
        <div className="lm-actions">
          <Button type="submit" variant="primary" disabled={action.busy}>
            {t(registering ? 'leagueManager.register' : 'leagueManager.signIn')}
          </Button>
          <Button disabled={action.busy} onClick={() => { action.clear(); setRegistering(!registering); }}>
            {t(registering ? 'leagueManager.signInInstead' : 'leagueManager.register')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function RosterForm({ league, onSave, onChange, busy }) {
  const { t } = useI18n();
  const [teamLines, setTeamLines] = useState(() => league?.teams.map(({ name }) => name).join('\n') || '');
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { names, error: rosterError } = parseTeamList(teamLines);
    setError(rosterError || null);
    if (rosterError) return;
    const saved = await onSave({ ...(league ? {} : { name: String(form.get('name')).trim() }), team_names: names });
    if (saved) {
      setTeamLines(names.join('\n'));
      onChange?.(false);
    }
  }

  return (
    <form className="lm-form" onSubmit={submit}>
      {!league && (
        <label>
          {t('leagueManager.leagueName')}
          <input name="name" required maxLength={100} readOnly={busy} />
        </label>
      )}
      <label>
        {t('leagueManager.teams')}
        <span className="lm-muted">{t('leagueManager.teamHelp')}</span>
        <textarea
          rows={6}
          required
          readOnly={busy}
          value={teamLines}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setTeamLines(value);
            onChange?.(value !== league.teams.map(({ name }) => name).join('\n'));
          }}
        />
      </label>
      {error && <ManagerError action={error} />}
      <Button type="submit" variant={league ? 'secondary' : 'primary'} disabled={busy}>
        {t(league ? 'leagueManager.saveTeams' : 'leagueManager.createLeague')}
      </Button>
    </form>
  );
}

function ShareLink({ shareId }) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState('');
  const field = useRef(null);
  const url = new URL(`${BASE}/share/${shareId}/`, window.location.origin).href;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
    } catch {
      field.current?.focus();
      field.current?.select();
      setCopyState('copyManually');
    }
  }

  return (
    <details className="lm-share">
      <summary className="button secondary">{t('leagueManager.share')}</summary>
      <div className="lm-panel lm-share-content">
        <p>{t('leagueManager.shareHelp')}</p>
        <label>
          {t('leagueManager.shareLink')}
          <input ref={field} type="url" readOnly value={url} />
        </label>
        <div className="lm-actions">
          <Button onClick={copy}>{t('leagueManager.copyLink')}</Button>
          <a href={url}>{t('leagueManager.openLink')}</a>
        </div>
        {copyState && <p role="status">{t(`leagueManager.${copyState}`)}</p>}
      </div>
    </details>
  );
}

function FixtureResult({ fixture, home, away, onScore, busy, scoreError }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const editButton = useRef(null);
  const firstGoal = useRef(null);
  const restoreFocus = useRef(false);
  const scored = isRecordedScore(fixture);

  useEffect(() => {
    if (editing) firstGoal.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  function close() {
    restoreFocus.current = true;
    setInvalid(false);
    setEditing(false);
  }

  async function save(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const score = parseScore(values.get('home'), values.get('away'));
    setInvalid(!score);
    if (score && await onScore(fixture.id, score)) close();
  }

  return (
    <li className="lm-fixture">
      <div className="lm-fixture-line">
        <strong>{home}</strong>
        <span className="lm-score">{scored ? `${fixture.home_goals} – ${fixture.away_goals}` : t('fixtures.versus')}</span>
        <strong>{away}</strong>
      </div>
      {editing ? (
        <form className="lm-form" onSubmit={save}>
          <div className="lm-goals">
            <label>
              {t('leagueManager.goalsForTeam', { team: home })}
              <input ref={firstGoal} name="home" inputMode="numeric" maxLength={3} defaultValue={fixture.home_goals ?? ''} required readOnly={busy} />
            </label>
            <label>
              {t('leagueManager.goalsForTeam', { team: away })}
              <input name="away" inputMode="numeric" maxLength={3} defaultValue={fixture.away_goals ?? ''} required readOnly={busy} />
            </label>
          </div>
          {invalid && <ManagerError action="invalidScore" />}
          {scoreError && !invalid && <ManagerError error={scoreError} />}
          <div className="lm-actions">
            <Button type="submit" variant="primary" disabled={busy}>{t('leagueManager.saveScore')}</Button>
            {scored && <Button disabled={busy} onClick={async () => { if (await onScore(fixture.id, CLEARED_SCORE)) close(); }}>
              {t('leagueManager.clearScore')}
            </Button>}
            <Button disabled={busy} onClick={close}>{t('leagueManager.cancel')}</Button>
          </div>
        </form>
      ) : onScore ? (
        <button
          ref={editButton}
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => setEditing(true)}
          aria-label={t(scored ? 'leagueManager.editFixture' : 'leagueManager.enterFixture', { home, away })}
        >
          {t(scored ? 'leagueManager.editScore' : 'leagueManager.enterScore')}
        </button>
      ) : !scored ? <p className="lm-muted">{t('leagueManager.unplayed')}</p> : null}
    </li>
  );
}

function Schedule({ league, onScore, busy, failedFixtureId, scoreError }) {
  const { t, formatNumber } = useI18n();
  const schedule = useMemo(() => matchdaySections(league.teams, league.fixtures), [league.teams, league.fixtures]);
  const teams = useMemo(() => new Map(league.teams.map(({ id, name }) => [id, name])), [league.teams]);
  const [matchday, setMatchday] = useState(() => onScore ? initialMatchday(schedule) : 1);
  const [changedTeams, setChangedTeams] = useState([]);
  const selected = schedule.find(({ number }) => number === matchday) || schedule[0];
  const SectionTitle = onScore ? 'h3' : 'h2';
  const recorded = league.fixtures.filter(isRecordedScore).length;
  const total = league.fixtures.length;
  const progressLabel = t('leagueManager.resultsRecorded', {
    recorded: formatNumber(recorded),
    total: formatNumber(total),
  });

  useEffect(() => {
    if (!changedTeams.length) return undefined;
    const timer = setTimeout(() => setChangedTeams([]), 2000);
    return () => clearTimeout(timer);
  }, [changedTeams]);

  async function saveScore(fixture, score) {
    const saved = await onScore(fixture.id, score);
    if (saved) setChangedTeams([fixture.home_team_id, fixture.away_team_id]);
    return saved;
  }

  const standings = (
    <aside className={onScore ? 'lm-panel lm-standings' : 'lm-panel'} aria-label={t('leagueManager.standings')}>
      <SectionTitle>{t('leagueManager.standings')}</SectionTitle>
      <div className="lm-table-scroll" role="region" aria-label={t('leagueManager.standings')} tabIndex={0}>
        <StandingsTable rows={league.standings} variant="managed" highlight={(row) => changedTeams.includes(row.team_id)} />
      </div>
    </aside>
  );

  return (
    <div className={onScore ? 'lm-competition lm-scoreboard' : 'lm-competition'}>
      {onScore && standings}
      <section className={onScore ? 'lm-panel lm-score-entry' : 'lm-panel'}>
        <div className="lm-score-header">
          <SectionTitle>{t(onScore ? 'leagueManager.scoresToEnter' : 'leagueManager.fixtures')}</SectionTitle>
          {onScore && total > 0 && (
            <label className="lm-progress">
              <span>{progressLabel}</span>
              <progress value={recorded} max={total} />
            </label>
          )}
        </div>
        {selected ? (
          <>
            <label className="lm-control">
              {t('leagueManager.matchday')}
              <select value={selected.number} disabled={busy} onChange={(e) => setMatchday(Number(e.currentTarget.value))}>
                {schedule.map(({ number }) => <option key={number} value={number}>{t('home.matchday', { number })}</option>)}
              </select>
            </label>
            {selected.bye && <p className="lm-bye">{t('leagueManager.bye', { team: selected.bye.name })}</p>}
            <ul className="lm-fixture-list">
              {selected.fixtures.map((fixture) => (
                <FixtureResult
                  key={fixture.id}
                  fixture={fixture}
                  home={teams.get(fixture.home_team_id)}
                  away={teams.get(fixture.away_team_id)}
                  onScore={onScore ? (id, score) => saveScore(fixture, score) : undefined}
                  busy={busy}
                  scoreError={failedFixtureId === fixture.id ? scoreError : undefined}
                />
              ))}
            </ul>
          </>
        ) : <EmptyState title={t('leagueManager.noFixtures')} />}
      </section>
      {!onScore && standings}
    </div>
  );
}

function OwnerLeagues({ account, onSignOut }) {
  const { t } = useI18n();
  const leagues = useRead('/leagues/');
  const [selectedLeagueId, setSelectedLeagueId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [rosterDirty, setRosterDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [scoreFixtureId, setScoreFixtureId] = useState(null);
  const items = leagues.value?.leagues ?? [];
  const leagueId = selectedLeagueId ?? (items.find(({ generated }) => generated) ?? items[0])?.id;
  const league = useRead(leagueId && !creating ? `/leagues/${leagueId}/` : null);
  const detail = league.value;
  const action = useAction();

  function changeWorkspace(id, create = false) {
    action.clear();
    setRosterDirty(false);
    setNotice('');
    setScoreFixtureId(null);
    setSelectedLeagueId(id);
    setCreating(create);
  }

  const withLeague = (suffix, method, body, fallback, message) => action.run(async () => {
    setNotice('');
    const updated = await request(`/leagues/${leagueId}/${suffix}`, method, body);
    league.setValue(updated);
    setNotice(message);
  }, fallback);

  return (
    <>
      <header className="lm-owner-toolbar">
        {items.length > 0 && (
          <label className="lm-league-switcher">
            {t('leagueManager.myLeagues')}
            <select value={creating ? '' : leagueId} disabled={action.busy} onChange={(event) => changeWorkspace(Number(event.currentTarget.value))}>
              {creating && <option value="" disabled>{t('leagueManager.createLeague')}</option>}
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
        <div className="lm-actions">
          {detail?.generated && <ShareLink key={detail.share_id} shareId={detail.share_id} />}
          {items.length > 0 && !creating && (
            <Button disabled={action.busy} onClick={() => changeWorkspace(leagueId, true)}>
              {t('leagueManager.createLeague')}
            </Button>
          )}
          <Button disabled={action.busy} onClick={() => {
            setScoreFixtureId(null);
            action.run(onSignOut, 'logoutFailed');
          }}>{t('leagueManager.signOut')}</Button>
        </div>
        <small className="lm-muted">{t('leagueManager.signedInAs', { username: account.username })}</small>
      </header>
      {action.error && scoreFixtureId == null && <ManagerError error={action.error} />}
      <p className={notice ? 'lm-notice' : 'sr-only'} role="status">{notice && t(`leagueManager.${notice}`)}</p>
      {leagues.status === 'error' ? <ManagerError error={leagues.error} onRetry={leagues.retry} />
        : leagues.status !== 'ready' ? <Skeleton />
          : creating || !leagueId ? (
            <section className="lm-panel lm-create">
              <h2>{t('leagueManager.createLeague')}</h2>
              {!items.length && <p>{t('leagueManager.noLeaguesHelp')}</p>}
              <RosterForm busy={action.busy} onSave={(body) => action.run(async () => {
                const added = await request('/leagues/', 'POST', body);
                leagues.setValue({ leagues: [added, ...items] });
                changeWorkspace(added.id);
              }, 'createFailed')} />
              {items.length > 0 && <div><Button disabled={action.busy} onClick={() => changeWorkspace(leagueId)}>{t('leagueManager.cancel')}</Button></div>}
            </section>
          ) : detail ? (
            <>
              <h2>{detail.name}</h2>
              {detail.generated ? (
                <Schedule
                  key={leagueId}
                  league={detail}
                  busy={action.busy}
                  failedFixtureId={scoreFixtureId}
                  scoreError={action.error}
                  onScore={(id, score) => {
                    setScoreFixtureId(id);
                    return withLeague(`fixtures/${id}/result/`, 'PUT', score, 'saveFailed', score.home_goals == null ? 'scoreCleared' : 'scoreSaved');
                  }}
                />
              ) : (
                <div className="lm-competition">
                  <section className="lm-panel">
                    <h3>{t('leagueManager.teams')}</h3>
                    <RosterForm key={leagueId} league={detail} busy={action.busy} onChange={setRosterDirty} onSave={(body) =>
                      withLeague('teams/', 'PUT', body, 'saveFailed', 'teamsSaved')
                    } />
                  </section>
                  <section className="lm-panel">
                    <h3>{t('leagueManager.generate')}</h3>
                    <p>{t('leagueManager.lockHelp')}</p>
                    <Button variant="primary" disabled={action.busy || rosterDirty} onClick={() =>
                      withLeague('generate/', 'POST', {}, 'generateFailed', 'scheduleGenerated')
                    }>{t('leagueManager.generate')}</Button>
                    {action.busy && <p role="status">{t('states.loading')}</p>}
                  </section>
                </div>
              )}
            </>
          ) : league.status === 'error' ? <ManagerError error={league.error} onRetry={league.retry} /> : <Skeleton />}
    </>
  );
}

function SharedLeague({ shareId }) {
  const { t } = useI18n();
  const share = useRead(`/shared/${encodeURIComponent(shareId)}/`);
  const unavailable = share.status === 'error' && share.error.status === 404;
  return (
    <>
      <header className="lm-header">
        <h1>{share.value?.name || t('nav.leagueManager')}</h1>
        <p>{t('leagueManager.readOnly')}</p>
      </header>
      {unavailable ? <EmptyState title={t('leagueManager.shareMissing')} text={t('leagueManager.shareMissingHelp')} />
        : share.status === 'error' ? <ManagerError error={share.error} onRetry={share.retry} />
          : share.status !== 'ready' ? <Skeleton />
            : <Schedule key={shareId} league={share.value} />}
    </>
  );
}

function OwnerManager() {
  const { t } = useI18n();
  const account = useRead('/account/');
  return (
    <>
      <header className="lm-header">
        <h1>{t('nav.leagueManager')}</h1>
        <p>{t('leagueManager.description')}</p>
      </header>
      {account.status === 'error' ? <ManagerError error={account.error} onRetry={account.retry} />
        : account.status !== 'ready' ? <Skeleton />
          : account.value.username ? (
            <OwnerLeagues account={account.value} onSignOut={async () => {
              account.setValue(await request('/account/logout/', 'POST', {}));
            }} />
          ) : <AccountForm onAuthenticated={account.setValue} />}
    </>
  );
}

export default function LeagueManager({ shareId = null }) {
  return (
    <section className="workspace league-manager">
      {shareId === null ? <OwnerManager /> : <SharedLeague shareId={shareId} />}
    </section>
  );
}
