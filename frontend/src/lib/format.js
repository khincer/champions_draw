export function shortTime(value) {
  if (!value) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function shortDay(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export function shortDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

// Kickoff falls within [yesterday 00:00, tomorrow 00:00) in local time.
export function inHomeRange(matchup) {
  const kickoff = matchup.kickoff ? new Date(matchup.kickoff) : null;
  if (!kickoff) return false;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return kickoff >= start && kickoff < end;
}
