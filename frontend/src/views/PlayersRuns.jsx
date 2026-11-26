import { Check, History, Loader, X } from 'lucide-preact';
import { StateMessage } from '../components/States';
import { useI18n } from '../i18n';

const STATUS_CUE = {
  completed: { Icon: Check, labelKey: 'draw.completed' },
  failed: { Icon: X, labelKey: 'draw.failed' },
  running: { Icon: Loader, labelKey: 'draw.runningStatus' },
};

function cueFor(status) {
  if (STATUS_CUE[status]) return STATUS_CUE[status];
  return { Icon: Loader, labelKey: 'draw.pending' };
}

export default function PlayersRuns({ draws }) {
  const { t, formatDate } = useI18n();
  return (
    <section className="history-list">
      {draws.length ? (
        draws.map((draw) => {
          const status = String(draw.status || 'pending').toLowerCase();
          const { Icon, labelKey } = cueFor(status);
          return (
            <article className="history-row" key={draw.id}>
              <span className={`status-dot ${status}`} aria-hidden="true">
                <Icon size={10} strokeWidth={3.5} />
              </span>
              <span className="sr-only">{t(labelKey)}</span>
              <div>
                <strong>{draw.player_name || 'Guest player'}</strong>
                <span>{draw.draw_seed} · {draw.method} - {draw.status} - {draw.matchups_created} fixtures - {formatDate(draw.completed_at)}</span>
                {draw.error_message && <em>{draw.error_message}</em>}
              </div>
            </article>
          );
        })
      ) : (
        <StateMessage icon={History} title={t('draw.noRuns')} text={t('draw.noRunsText')} />
      )}
    </section>
  );
}
