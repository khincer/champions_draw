/* Thin wrapper over Object.groupBy so the call sites keep their (items, key)
   shape and the 'Unassigned' default for a missing key. The native version also
   returns a null-prototype object, so a '__proto__' group key can no longer
   collide with Object.prototype.

   ponytail: Object.groupBy is Baseline 2024 (Chrome 117, Safari 17.4, Firefox
   119). If an older browser ever matters, swap the body back to the reduce form
   rather than adding a polyfill. */
export function groupBy(items, key) {
  return Object.groupBy(items, (item) => item[key] ?? 'Unassigned');
}
