import { Play } from 'lucide-preact';
import Button from '../components/Button';
import { useI18n } from '../i18n';

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
  const { t } = useI18n();
  return (
    <section className="command-band">
      <div>
        <h2 className="command-band-title">{t('draw.simulationTitle')}</h2>
        <p>{t('draw.simulationText')}</p>
      </div>
      <div className="draw-controls">
        <label className="seed-input">
          <span>{t('draw.playerName')}</span>
          <input
            value={playerName}
            maxLength={80}
            placeholder={t('picks.yourName')}
            onInput={(event) => setPlayerName(event.currentTarget.value)}
          />
        </label>
        <label className="seed-input">
          <span>{t('draw.seasonYear')}</span>
          <select disabled={working} value={selectedSeasonId} onChange={(event) => setSelectedSeasonId(event.currentTarget.value)}>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>
        <label className="seed-input">
          <span>{t('draw.drawMethod')}</span>
          <select value={drawMethod} onChange={(event) => setDrawMethod(event.currentTarget.value)}>
            <option value="sequential">{t('draw.sequential')}</option>
            <option value="interactive">{t('draw.interactive')}</option>
          </select>
        </label>
        <Button variant="primary" disabled={working || !selectedSeasonId} onClick={() => generateDraw()}>
          <Play size={16} />
          {working ? t('draw.running') : t('draw.runSimulation')}
        </Button>
      </div>
    </section>
  );
}
