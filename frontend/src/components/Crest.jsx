import { useState } from 'preact/hooks';

export default function Crest({ team, size = 'md', className = '', noFallback = false }) {

  const [failedUrl, setFailedUrl] = useState(null);
  const name = team?.name || team?.short_name || '';
  const initials = (team?.short_name || team?.name || '').slice(0, 3);
  const logoUrl = team?.logo_url || '';
  const showImage = Boolean(logoUrl) && logoUrl !== failedUrl;

  return (
    <span className={`team-logo ${size} ${className}`.trim()} role="img" aria-label={name}>
      {showImage ? (
        <img src={logoUrl} alt="" loading="lazy" onError={() => setFailedUrl(logoUrl)} />
      ) : noFallback ? null : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}

/* Team badge (Design.md §7.4): crest + short name + association code. */
export function TeamBadge({ team, align }) {
  return (
    <span className={`team-badge ${align === 'right' ? 'right' : ''}`.trim()}>
      <Crest team={team} size="sm" />
      <b>{team.short_name}</b>
      <span>{team.association.code}</span>
    </span>
  );
}
