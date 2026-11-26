/* Resolve a machine code or catalogue key to translated human copy.  Every
   api.js failure carries a stable `.code` (forbidden / notFound / server /
   network / unknown), and shell notices name their own catalogue key through
   `notice.key`. Both routes converge here so the copy follows the active
   locale. An unrecognised code falls back to the generic message — no call
   site can ever surface a raw key. */
export default function errorText(t, value) {
  if (!value) return '';
  const key = value.includes('.') ? value : `errors.${value}`;
  const text = t(key);
  return text === key ? t('errors.unknown') : text;
}
