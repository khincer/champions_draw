import Button from './Button';

export function StateMessage({ icon: Icon, title, text }) {
  return (
    <div className="state-message">
      {Icon ? <Icon size={22} aria-hidden="true" /> : null}
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function Skeleton({ rows = 3, label = 'Loading', className = '', variant = 'table' }) {
  return (
    <div className={`skeleton skeleton--${variant} ${className}`.trim()} aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">{label}</span>
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

export function ErrorState({ title, detail, reference, onRetry, retryLabel = 'Retry' }) {
  return (
    <div className="state-error" role="alert">
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
      {reference ? <p className="state-reference">{reference}</p> : null}
      {onRetry ? <Button className="state-retry" onClick={onRetry}>{retryLabel}</Button> : null}
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
