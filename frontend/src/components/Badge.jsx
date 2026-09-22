export default function Badge({ tone = 'neutral', icon: Icon, children, className = '' }) {
  return (
    <span className={`badge badge-${tone} ${className}`.trim()}>
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
