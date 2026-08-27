import { useMemo, useState } from 'preact/hooks';
import {
  ArrowLeft,
  ArrowRight,
  Flag,
  Home,
  Medal,
  RotateCcw,
  Shield,
  Sparkles,
  Trophy,
} from 'lucide-preact';

import clubData from './careerClubs.json';
import {
  applyCareerChoice,
  createCareer,
  isCareerState,
  POSITIONS,
  summarizeCareer,
} from './careerEngine.mjs';

export const CAREER_STORAGE_KEY = 'champions_draw_career_v1';

const COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN
BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL
GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM
JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME
MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP
NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD
SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO
TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/);

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const COUNTRIES = COUNTRY_CODES
  .map((code) => ({ code, name: countryNames.of(code) || code }))
  .sort((left, right) => left.name.localeCompare(right.name));

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function buildCatalog(seasonTeams) {
  const logoByName = new Map();
  for (const team of seasonTeams || []) {
    if (team.logo_url) logoByName.set(normalizeName(team.name), team.logo_url);
  }
  return clubData.map((club) => ({
    ...club,
    logoUrl: club.logoUrl || logoByName.get(normalizeName(club.name)) || '',
  }));
}

function loadStoredCareer() {
  try {
    const raw = localStorage.getItem(CAREER_STORAGE_KEY);
    if (!raw) return { career: null, notice: '' };
    const career = JSON.parse(raw);
    if (isCareerState(career)) return { career, notice: '' };
    localStorage.removeItem(CAREER_STORAGE_KEY);
    return { career: null, notice: 'An incompatible career save was removed.' };
  } catch {
    try {
      localStorage.removeItem(CAREER_STORAGE_KEY);
    } catch {
      // Storage is unavailable; the in-memory game still works.
    }
    return { career: null, notice: 'The previous career save could not be restored.' };
  }
}

function saveStoredCareer(career) {
  try {
    localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(career));
    return true;
  } catch {
    return false;
  }
}

function clearStoredCareer() {
  try {
    localStorage.removeItem(CAREER_STORAGE_KEY);
  } catch {
    // Storage may be disabled.
  }
}

export function hasSavedCareer() {
  return Boolean(loadStoredCareer().career);
}

function makeSeed() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return Date.now() >>> 0;
}

function flagEmoji(countryCode) {
  if (!/^[A-Z]{2}$/.test(countryCode || '')) return '⚑';
  return [...countryCode].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('');
}

function formatValue(value) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `€${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  return `€${Math.round(value / 1_000)}K`;
}

export default function CareerApp({
  defaultName,
  seasonTeams,
  onHome,
  onCareerAvailabilityChange,
}) {
  const [initialLoad] = useState(() => loadStoredCareer());
  const [career, setCareer] = useState(initialLoad.career);
  const [notice, setNotice] = useState(initialLoad.notice);
  const [buildingIdentity, setBuildingIdentity] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const catalog = useMemo(() => buildCatalog(seasonTeams), [seasonTeams]);
  const clubById = useMemo(() => new Map(catalog.map((club) => [club.id, club])), [catalog]);

  function persist(nextCareer) {
    setCareer(nextCareer);
    onCareerAvailabilityChange(true);
    setNotice(
      saveStoredCareer(nextCareer)
        ? ''
        : 'Career progress is active, but browser storage is unavailable.',
    );
  }

  function startCareer(identity) {
    try {
      persist(createCareer(identity, makeSeed(), catalog));
      setBuildingIdentity(false);
      setShowSummary(false);
    } catch (error) {
      setNotice(error.message);
    }
  }

  function chooseOption(choiceId) {
    try {
      persist(applyCareerChoice(career, choiceId, catalog));
    } catch (error) {
      setNotice(error.message);
    }
  }

  function resetCareer({ confirm = false } = {}) {
    if (
      confirm &&
      career &&
      !window.confirm('Start a new career? Your current progress will be deleted.')
    ) {
      return;
    }
    clearStoredCareer();
    setCareer(null);
    setNotice('');
    setShowSummary(false);
    setBuildingIdentity(true);
    onCareerAvailabilityChange(false);
  }

  return (
    <section className="career-shell">
      <header className="career-topbar">
        <button className="career-nav-button" onClick={onHome}>
          <Home size={17} />
          Home
        </button>
        <div className="career-wordmark">
          <span>Champions Draw</span>
          <strong>Player Career</strong>
        </div>
        {career ? (
          <button className="career-nav-button" onClick={() => resetCareer({ confirm: true })}>
            <RotateCcw size={17} />
            New career
          </button>
        ) : (
          <span className="career-nav-spacer" />
        )}
      </header>

      {notice ? <div className="career-notice" role="status">{notice}</div> : null}

      {!career && !buildingIdentity ? (
        <CareerIntro onStart={() => setBuildingIdentity(true)} />
      ) : null}

      {!career && buildingIdentity ? (
        <IdentityBuilder
          defaultName={defaultName}
          onBack={() => setBuildingIdentity(false)}
          onConfirm={startCareer}
        />
      ) : null}

      {career && showSummary ? (
        <CareerSummary
          career={career}
          catalog={catalog}
          onBack={() => setShowSummary(false)}
          onPlayAgain={() => resetCareer()}
        />
      ) : null}

      {career && !showSummary ? (
        <CareerDashboard
          career={career}
          clubById={clubById}
          onChoose={chooseOption}
          onSummary={() => setShowSummary(true)}
          onPlayAgain={() => resetCareer()}
        />
      ) : null}
    </section>
  );
}

function CareerIntro({ onStart }) {
  return (
    <main className="career-intro">
      <div className="career-intro-copy">
        <span className="career-kicker">A 24-year football story</span>
        <h1>Build the career they will remember.</h1>
        <p>
          Start at sixteen, choose every move, take calculated risks, and watch one decision
          become a lifetime of clubs, goals, setbacks, and silverware.
        </p>
        <button className="career-primary-action" onClick={onStart}>
          Create your player
          <ArrowRight size={19} />
        </button>
      </div>
      <div className="career-intro-board" aria-label="Career simulator features">
        <div className="career-board-stripe">PLAYER CAREER · 2025/26</div>
        <div className="career-board-number">40</div>
        <strong>Retirement age</strong>
        <div className="career-board-grid">
          <span><b>100</b> clubs</span>
          <span><b>5</b> countries</span>
          <span><b>12</b> decisions</span>
          <span><b>1</b> legacy</span>
        </div>
      </div>
    </main>
  );
}

function IdentityBuilder({ defaultName, onBack, onConfirm }) {
  const [identity, setIdentity] = useState({
    name: defaultName && defaultName !== 'Guest player' ? defaultName : '',
    number: 10,
    foot: 'right',
    nationality: '',
    position: '',
  });
  const [countryQuery, setCountryQuery] = useState('');
  const [countryLimit, setCountryLimit] = useState(24);
  const filteredCountries = useMemo(() => {
    const query = countryQuery.trim().toLowerCase();
    if (!query) return COUNTRIES;
    return COUNTRIES.filter(
      (country) =>
        country.name.toLowerCase().includes(query) || country.code.toLowerCase().includes(query),
    );
  }, [countryQuery]);
  const isValid =
    identity.name.trim() &&
    identity.number >= 1 &&
    identity.number <= 99 &&
    identity.nationality &&
    identity.position;

  return (
    <main className="identity-builder">
      <div className="identity-heading">
        <button className="career-text-button" onClick={onBack}>
          <ArrowLeft size={17} />
          Back
        </button>
        <span className="career-kicker">Step 01 · Player identity</span>
        <h1>Define who steps onto the pitch.</h1>
        <p>The number and preferred foot shape the card. Position drives every career statistic.</p>
      </div>

      <div className="identity-layout">
        <section className="identity-panel" aria-labelledby="identity-basics-title">
          <h2 id="identity-basics-title">The shirt</h2>
          <label className="career-field">
            <span>Name or surname</span>
            <input
              value={identity.name}
              maxLength={80}
              placeholder="e.g. Morgan"
              onInput={(event) => setIdentity({ ...identity, name: event.currentTarget.value })}
            />
          </label>
          <label className="career-field">
            <span>Squad number</span>
            <input
              type="number"
              min="1"
              max="99"
              value={identity.number}
              onInput={(event) =>
                setIdentity({ ...identity, number: Number(event.currentTarget.value) })
              }
            />
          </label>
          <fieldset className="career-choice-group">
            <legend>Preferred foot</legend>
            <div className="career-segmented">
              {['left', 'right'].map((foot) => (
                <button
                  type="button"
                  className={identity.foot === foot ? 'selected' : ''}
                  aria-pressed={identity.foot === foot}
                  onClick={() => setIdentity({ ...identity, foot })}
                  key={foot}
                >
                  {foot}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="career-choice-group">
            <legend>Position</legend>
            <div className="position-grid">
              {POSITIONS.map((position) => (
                <button
                  type="button"
                  className={identity.position === position ? 'selected' : ''}
                  aria-pressed={identity.position === position}
                  onClick={() => setIdentity({ ...identity, position })}
                  key={position}
                >
                  {position}
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="identity-panel country-panel" aria-labelledby="nationality-title">
          <div className="identity-section-head">
            <div>
              <h2 id="nationality-title">Nationality</h2>
              <p>
                {identity.nationality
                  ? `${flagEmoji(identity.nationality)} ${countryNames.of(identity.nationality)}`
                  : 'Choose the national team on your player card.'}
              </p>
            </div>
            <Flag size={24} />
          </div>
          <label className="career-field">
            <span>Search countries</span>
            <input
              type="search"
              value={countryQuery}
              placeholder="Search by name or code"
              onInput={(event) => {
                setCountryQuery(event.currentTarget.value);
                setCountryLimit(24);
              }}
            />
          </label>
          <div className="country-grid">
            {filteredCountries.slice(0, countryLimit).map((country) => (
              <button
                type="button"
                className={identity.nationality === country.code ? 'selected' : ''}
                aria-pressed={identity.nationality === country.code}
                onClick={() => setIdentity({ ...identity, nationality: country.code })}
                key={country.code}
              >
                <span aria-hidden="true">{flagEmoji(country.code)}</span>
                <b>{country.name}</b>
                <small>{country.code}</small>
              </button>
            ))}
          </div>
          {filteredCountries.length > countryLimit ? (
            <button
              type="button"
              className="career-show-more"
              onClick={() => setCountryLimit((current) => current + 24)}
            >
              Show more countries
            </button>
          ) : null}
        </section>
      </div>

      <div className="identity-confirm">
        <span>{isValid ? 'Your first academy offers are ready.' : 'Complete every field to continue.'}</span>
        <button
          className="career-primary-action"
          disabled={!isValid}
          onClick={() => onConfirm(identity)}
        >
          Confirm player
          <ArrowRight size={19} />
        </button>
      </div>
    </main>
  );
}

function CareerDashboard({ career, clubById, onChoose, onSummary, onPlayAgain }) {
  const currentClub = clubById.get(career.currentClubId);
  return (
    <main className="career-dashboard">
      <PlayerCard career={career} club={currentClub} />

      {career.lastOutcome ? (
        <div className="career-outcome" role="status">
          <Sparkles size={18} />
          <span>{career.lastOutcome}</span>
        </div>
      ) : null}

      {career.status === 'active' ? (
        <EventPanel event={career.event} clubById={clubById} onChoose={onChoose} />
      ) : (
        <RetirementPanel onSummary={onSummary} onPlayAgain={onPlayAgain} />
      )}

      <CareerTimeline career={career} clubById={clubById} />
    </main>
  );
}

function PlayerCard({ career, club }) {
  const countryName = countryNames.of(career.identity.nationality);
  return (
    <section className="player-card">
      <div className="player-rating">
        <span>OVR</span>
        <strong>{career.ovr}</strong>
      </div>
      <div className="player-identity">
        <span className="player-country">
          <b aria-hidden="true">{flagEmoji(career.identity.nationality)}</b>
          {countryName}
        </span>
        <h1>{career.identity.name}</h1>
        <p>#{career.identity.number} · {career.identity.position} · {career.identity.foot}-footed</p>
      </div>
      <div className="player-club">
        <ClubLogo club={club} size="lg" key={club?.id || 'free-agent'} />
        <div>
          <span>Current club</span>
          <strong>{club?.name || 'Free agent'}</strong>
          <small>{club?.league || 'Awaiting academy offer'}</small>
        </div>
      </div>
      <div className="player-metrics">
        <Metric label="Age" value={career.age} />
        <Metric label="Value" value={formatValue(career.value)} />
        <Metric label="Apps" value={career.totals.appearances} />
        <Metric label="Goals" value={career.totals.goals} />
        <Metric label="Assists" value={career.totals.assists} />
      </div>
      <TrophyShelf trophies={career.trophies} />
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="career-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TrophyShelf({ trophies }) {
  return (
    <div className="career-trophy-shelf" aria-label="Trophy cabinet">
      <Trophy size={19} />
      {trophies.length ? (
        <div>
          <strong>{trophies.length} trophies</strong>
          <span>{trophies.slice(-3).map((trophy) => trophy.name).join(' · ')}</span>
        </div>
      ) : (
        <div>
          <strong>Empty cabinet</strong>
          <span>Your first trophy is still ahead.</span>
        </div>
      )}
    </div>
  );
}

function EventPanel({ event, clubById, onChoose }) {
  return (
    <section className="career-event-panel" aria-labelledby="career-event-title">
      <div className="career-event-copy">
        <span className="career-kicker">Decision required</span>
        <h2 id="career-event-title">{event.title}</h2>
        <p>{event.description}</p>
      </div>
      <div className="career-option-grid">
        {event.options.map((option) => {
          const club = option.clubId ? clubById.get(option.clubId) : null;
          return (
            <button className="career-option" onClick={() => onChoose(option.id)} key={option.id}>
              <ClubLogo club={club} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RetirementPanel({ onSummary, onPlayAgain }) {
  return (
    <section className="retirement-panel">
      <span className="career-kicker">Full time</span>
      <Trophy size={42} />
      <h2>Your playing career is complete.</h2>
      <p>Twenty-four years of decisions are now one football legacy.</p>
      <div>
        <button className="career-primary-action" onClick={onSummary}>View career summary</button>
        <button className="career-secondary-action" onClick={onPlayAgain}>Play again</button>
      </div>
    </section>
  );
}

function CareerTimeline({ career, clubById }) {
  return (
    <section className="career-timeline" aria-labelledby="career-timeline-title">
      <div className="career-section-heading">
        <div>
          <span className="career-kicker">Every two years</span>
          <h2 id="career-timeline-title">Career timeline</h2>
        </div>
        <span>{career.timeline.length}/12 chapters</span>
      </div>
      <div className="career-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Age</th>
              <th>Club</th>
              <th>Role</th>
              <th>OVR</th>
              <th>Apps</th>
              <th>Goals</th>
              <th>Assists</th>
              <th>Moment</th>
            </tr>
          </thead>
          <tbody>
            {career.timeline.map((period) => {
              const club = clubById.get(period.clubId);
              const achievements = period.achievements.map((item) => item.name).join(', ');
              return (
                <tr key={`${period.age}:${period.clubId}`}>
                  <td><strong>{period.age}</strong></td>
                  <td>
                    <span className="timeline-club">
                      <ClubLogo club={club} size="sm" />
                      {club?.name || 'Unknown club'}
                    </span>
                  </td>
                  <td className="career-capitalize">{period.role}</td>
                  <td>{period.ovr}</td>
                  <td>{period.appearances}</td>
                  <td>{period.goals}</td>
                  <td>{period.assists}</td>
                  <td>{achievements || period.outcome}</td>
                </tr>
              );
            })}
            {career.status === 'active' ? (
              <tr className="timeline-pending">
                <td><strong>{career.age}</strong></td>
                <td colSpan="7">Choosing the next chapter…</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CareerSummary({ career, catalog, onBack, onPlayAgain }) {
  const summary = useMemo(() => summarizeCareer(career, catalog), [career, catalog]);
  const countryName = countryNames.of(summary.identity.nationality);
  return (
    <main className="career-summary">
      <button className="career-text-button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to final card
      </button>
      <header className="summary-hero">
        <div>
          <span className="career-kicker">Career complete</span>
          <h1>{summary.identity.name}</h1>
          <p>#{summary.identity.number} · {summary.identity.position} · {countryName}</p>
        </div>
        <span className="summary-flag" aria-hidden="true">{flagEmoji(summary.identity.nationality)}</span>
      </header>

      <section className="summary-metrics" aria-label="Career totals">
        <Metric label="Peak OVR" value={summary.peakOvr} />
        <Metric label="Peak value" value={formatValue(summary.peakValue)} />
        <Metric label="Appearances" value={summary.totals.appearances} />
        <Metric label="Goals" value={summary.totals.goals} />
        <Metric label="Assists" value={summary.totals.assists} />
      </section>

      <section className="summary-cabinets">
        <SummaryCabinet
          icon={Flag}
          title="National team"
          subtitle={summary.calledUp ? `Represented ${countryName}` : 'No senior call-up'}
          items={summary.internationalTrophies.map((item) => item.name)}
        />
        <SummaryCabinet
          icon={Trophy}
          title="Club trophies"
          subtitle={`${summary.trophies.length} won`}
          items={summary.trophies.map((item) => `${item.name} · age ${item.age}`)}
        />
        <SummaryCabinet
          icon={Medal}
          title="Individual awards"
          subtitle={`${summary.awards.length} earned`}
          items={summary.awards.map((item) => `${item.name} · age ${item.age}`)}
        />
      </section>

      <section className="summary-clubs" aria-labelledby="summary-clubs-title">
        <div className="career-section-heading">
          <div>
            <span className="career-kicker">The journey</span>
            <h2 id="summary-clubs-title">Club by club</h2>
          </div>
          <span>{summary.clubs.length} clubs</span>
        </div>
        <div className="summary-club-grid">
          {summary.clubs.map((entry) => (
            <article className="summary-club-card" key={entry.club.id}>
              <ClubLogo club={entry.club} size="lg" />
              <div>
                <h3>{entry.club.name}</h3>
                <p>{entry.club.league}</p>
              </div>
              <div className="summary-club-stats">
                <span><b>{entry.appearances}</b> Apps</span>
                <span><b>{entry.goals}</b> Goals</span>
                <span><b>{entry.assists}</b> Assists</span>
              </div>
              {entry.trophies.length || entry.statuses.length ? (
                <small>{[...entry.trophies, ...entry.statuses].join(' · ')}</small>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <div className="summary-actions">
        <button className="career-primary-action" onClick={onPlayAgain}>
          <RotateCcw size={18} />
          Play again
        </button>
      </div>
    </main>
  );
}

function SummaryCabinet({ icon: Icon, title, subtitle, items }) {
  return (
    <article className="summary-cabinet">
      <Icon size={22} />
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {items.length ? (
        <ul>{items.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul>
      ) : (
        <span className="empty-cabinet">Cabinet empty</span>
      )}
    </article>
  );
}

function ClubLogo({ club, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  const showImage = club?.logoUrl && !failed;
  return (
    <span className={`career-club-logo ${size}`} aria-hidden="true">
      {showImage ? (
        <img src={club.logoUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : club ? (
        club.shortName.slice(0, 3)
      ) : (
        <Shield size={size === 'lg' ? 28 : 20} />
      )}
    </span>
  );
}
