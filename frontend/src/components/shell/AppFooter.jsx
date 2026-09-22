import { useI18n } from '../../i18n';

export default function AppFooter() {
  const { t } = useI18n();
  return <footer className="app-footer">{t('shell.footer')}</footer>;
}
