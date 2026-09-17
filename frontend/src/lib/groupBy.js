export function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key] ?? 'Unassigned';
    groups[value] = groups[value] || [];
    groups[value].push(item);
    return groups;
  }, {});
}
