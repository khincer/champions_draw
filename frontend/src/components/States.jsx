import Button from './Button';

/* UI state primitives (Design.md §11–§12).
   Presentational only — each fetch site owns `{status, error, retry}` and picks
   one of these; no component here calls the network. The fetch-site adoption is
   Phase 4. */
export function StateMessage({ icon: Icon, title, text }) {
  return (
    <div className="state-message">
      {Icon ? <Icon size={22} aria-hidden="true" /> : null}
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

/* Loading keeps the eventual row dimensions and marks the region busy, so a
   screen reader hears "loading" and the layout does not jump when data lands.
   `variant` names the surface the skeleton stands in for; each one maps to the
   settled row height of that surface in styles.css. Default is a table row. */
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

/* Empty states explain why there is nothing and offer the next action. */
export function EmptyState({ title, text, action }) {
  return (
    <div className="state-message state-empty">
      <strong>{title}</strong>
      <span>{text}</span>
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

/* Errors name what failed, say whether a retry is available, and retry only
   the request that failed. Announced through `role="alert"`. */
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

/* Live region for async transitions — loading → error and loading → success.
   Never mounted per poll tick; a poll writes its message into the region. */
export function LiveRegion({ message, tone = 'info' }) {
  return (
    <p className={`live-region live-region-${tone}`} role="status" aria-live="polite">
      {message}
    </p>
  );
}
