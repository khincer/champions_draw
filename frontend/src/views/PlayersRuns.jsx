import { History } from 'lucide-preact';
import { StateMessage } from '../components/States';
import { shortDate } from '../lib/format';

export default function PlayersRuns({ draws }) {
  return (
    <section className="history-list">
      {draws.length ? (
        draws.map((draw) => (
          <article className="history-row" key={draw.id}>
            <span className={`status-dot ${draw.status.toLowerCase()}`} />
            <div>
              <strong>{draw.player_name || 'Guest player'}</strong>
              <span>{draw.draw_seed} · {draw.method} - {draw.status} - {draw.matchups_created} fixtures - {shortDate(draw.completed_at)}</span>
              {draw.error_message && <em>{draw.error_message}</em>}
            </div>
          </article>
        ))
      ) : (
        <StateMessage icon={History} title="No player runs yet" text="Run the first simulation and it will appear here." />
      )}
    </section>
  );
}
