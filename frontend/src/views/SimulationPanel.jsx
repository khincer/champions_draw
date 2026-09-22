import { Play } from 'lucide-preact';
import Button from '../components/Button';

export default function SimulationPanel({
  playerName,
  setPlayerName,
  seasons,
  selectedSeasonId,
  setSelectedSeasonId,
  drawMethod,
  setDrawMethod,
  working,
  generateDraw,
}) {
  return (
    <section className="command-band">
      <div>
        <h2 className="command-band-title">Run your Champions League simulation</h2>
        <p>
          Enter your player name, choose a season, and publish a league-phase prediction. Every run is saved so other
          players can compare fixtures, pots, and outcomes.
        </p>
      </div>
      <div className="draw-controls">
        <label className="seed-input">
          <span>Player name</span>
          <input
            value={playerName}
            maxLength={80}
            placeholder="Your name"
            onInput={(event) => setPlayerName(event.currentTarget.value)}
          />
        </label>
        <label className="seed-input">
          <span>Season year</span>
          <select value={selectedSeasonId} onChange={(event) => setSelectedSeasonId(event.currentTarget.value)}>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>
        <label className="seed-input">
          <span>Draw method</span>
          <select value={drawMethod} onChange={(event) => setDrawMethod(event.currentTarget.value)}>
            <option value="sequential">Sequential (UEFA-style)</option>
            <option value="interactive">Interactive (pick by pick)</option>
          </select>
        </label>
        <Button variant="primary" disabled={working || !selectedSeasonId} onClick={() => generateDraw()}>
          <Play size={16} />
          {working ? 'Running' : 'Run simulation'}
        </Button>
      </div>
    </section>
  );
}
