/* Metric card (Design.md §7.2): one dominant number, a short label, optional
   supporting text and an optional trend. A trend always carries text (and
   optionally an icon), never color alone. */
export default function Metric({ label, value, support, trend, icon: Icon }) {
  const TrendIcon = trend?.icon;

  return (
    <div className="metric">
      {Icon ? <Icon className="metric-icon" size={16} aria-hidden="true" /> : null}
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {support ? <span className="metric-support">{support}</span> : null}
      {trend ? (
        <span className={`metric-trend metric-trend-${trend.tone || 'neutral'}`}>
          {TrendIcon ? <TrendIcon size={12} aria-hidden="true" /> : null}
          {trend.label}
        </span>
      ) : null}
    </div>
  );
}
