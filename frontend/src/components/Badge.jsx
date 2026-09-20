/* Status badge (Design.md §7.7).
   Colour is never the only signal: the label text always states the status, so
   the badge still reads in monochrome. Tones cover the §7.7 vocabulary. */
export default function Badge({ tone = 'neutral', icon: Icon, children, className = '' }) {
  return (
    <span className={`badge badge-${tone} ${className}`.trim()}>
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
