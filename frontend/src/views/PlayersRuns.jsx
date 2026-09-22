import { Check, History, Loader, X } from 'lucide-preact';
import { StateMessage } from '../components/States';
import { shortDate } from '../lib/format';

const STATUS_CUE = {
  completed: { Icon: Check, label: 'Completed' },
  failed: { Icon: X, label: 'Failed' },
  running: { Icon: Loader, label: 'Running' },
};

function cueFor(status) {
  if (STATUS_CUE[status]) return STATUS_CUE[status];
  return { Icon: Loader, label: status ? status[0].toUpperCase() + status.slice(1) : 'Pending' };
}

export default function PlayersRuns({ draws }) {
  return (
    <section className="history-list">
      {draws.length ? (
        draws.map((draw) => {
          const status = String(draw.status || 'pending').toLowerCase();
          const { Icon, label } = cueFor(status);
          return (
            <article className="history-row" key={draw.id}>
              <span className={`status-dot ${status}`} aria-hidden="true">
                <Icon size={10} strokeWidth={3.5} />
              </span>
              <span className="sr-only">{label}</span>
              <div>
                <strong>{draw.player_name || 'Guest player'}</strong>
                <span>{draw.draw_seed} · {draw.method} - {draw.status} - {draw.matchups_created} fixtures - {shortDate(draw.completed_at)}</span>
                {draw.error_message && <em>{draw.error_message}</em>}
              </div>
            </article>
          );
        })
      ) : (
        <StateMessage icon={History} title="No player runs yet" text="Run the first simulation and it will appear here." />
      )}
    </section>
  );
}
