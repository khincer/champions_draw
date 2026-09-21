export function groupBy(items, key) {
  return Object.groupBy(items, (item) => item[key] ?? 'Unassigned');
}
