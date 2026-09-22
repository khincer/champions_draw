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
