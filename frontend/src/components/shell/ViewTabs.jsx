import SegmentControl from '../SegmentControl';

export default function ViewTabs({ activeTab, setActiveTab }) {
  return (
    <SegmentControl
      className="view-tabs"
      label="Workspace sections"
      value={activeTab}
      onChange={setActiveTab}
      items={[
        { key: 'simulate', label: 'Run simulation' },
        { key: 'matchdays', label: 'Fixtures' },
        { key: 'predict', label: 'Predict' },
        { key: 'pots', label: 'Pots' },
        { key: 'teams', label: 'Leagues' },
        { key: 'history', label: 'Saved runs' },
      ]}
    />
  );
}
