import Button from './Button';
import { useI18n } from '../i18n';

export function StateMessage({ icon: Icon, title, text }) {
  return (
    <div className="state-message">
      {Icon ? <Icon size={22} aria-hidden="true" /> : null}
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

/* The two text-bearing defaults come from the catalogue so a caller that passes
   nothing still renders translated copy; an explicit prop always wins. */
export function Skeleton({ rows = 3, label, className = '', variant = 'table' }) {
  const { t } = useI18n();
  return (
    <div className={`skeleton skeleton--${variant} ${className}`.trim()} aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">{label ?? t('states.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index} />
      ))}
    </div>
  );
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="state-message state-empty">
      <strong>{title}</strong>
      <span>{text}</span>
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, detail, reference, onRetry, retryLabel }) {
  const { t } = useI18n();
  return (
    <div className="state-error" role="alert">
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
      {reference ? <p className="state-reference">{reference}</p> : null}
      {onRetry ? <Button className="state-retry" onClick={onRetry}>{retryLabel ?? t('states.retry')}</Button> : null}
    </div>
  );
}

export function LiveRegion({ message, tone = 'info' }) {
  return (
    <p className={`live-region live-region-${tone}`} role="status" aria-live="polite">
      {message}
    </p>
  );
}
