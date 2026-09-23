import SegmentControl from '../SegmentControl';
import { useI18n } from '../../i18n';

export default function ViewTabs({ activeTab, setActiveTab }) {
  const { t } = useI18n();
  return (
    <SegmentControl
      className="view-tabs"
      label={t('tabs.workspaceSections')}
      value={activeTab}
      onChange={setActiveTab}
      items={[
        { key: 'simulate', label: t('tabs.simulate') },
        { key: 'matchdays', label: t('tabs.matchdays') },
        { key: 'predict', label: t('tabs.predict') },
        { key: 'pots', label: t('tabs.pots') },
        { key: 'teams', label: t('tabs.teams') },
        { key: 'history', label: t('tabs.history') },
      ]}
    />
  );
}
