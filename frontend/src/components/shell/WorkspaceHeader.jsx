import ChampionsLeagueLogo from './ChampionsLeagueLogo';
import ViewTabs from './ViewTabs';

export default function WorkspaceHeader({ activeTab, setActiveTab }) {
  return (
    <header className="workspace-header">
      <ChampionsLeagueLogo />
      <ViewTabs activeTab={activeTab} setActiveTab={setActiveTab} />
    </header>
  );
}
