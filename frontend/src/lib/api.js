export const API_ROOT = '/api';

/* Stable machine codes for user-facing failures. The shell renders translated
   copy from these (`t('errors.' + code)`), so DRF's English `detail` never
   reaches the screen. A code the backend supplies wins over the status map. */
const STATUS_CODES = { 401: 'forbidden', 403: 'forbidden', 404: 'notFound' };

function codeForStatus(status) {
  if (STATUS_CODES[status]) return STATUS_CODES[status];
  return status >= 500 && status < 600 ? 'server' : 'unknown';
}

export function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

export async function apiFetch(path, options = {}) {
  try {
    const headers = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    };
    const csrfToken = getCookie('csrftoken');
    if (csrfToken && options.method && options.method !== 'GET') {
      headers['X-CSRFToken'] = csrfToken;
    }

    const response = await fetch(`${API_ROOT}${path}`, {
      credentials: 'same-origin',
      ...options,
      headers,
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (cause) {
        /* A non-JSON body (a proxy error page) must not surface as a parse
           error when the HTTP status already names the failure. */
        const failure = new Error(`Request failed with ${response.status}`);
        failure.status = response.status;
        failure.code = codeForStatus(response.status);
        failure.cause = cause;
        throw failure;
      }
    }
    if (!response.ok) {
      const failure = new Error(payload?.detail || `Request failed with ${response.status}`);
      failure.status = response.status;
      failure.code = payload?.code || codeForStatus(response.status);
      throw failure;
    }
    return payload;
  } catch (err) {
    if (err?.code) throw err;
    /* Every other failure — a network TypeError, an unparseable body — is
       normalized here so no caller can ever receive an uncoded failure. The
       message keeps its previous text for logs and for consumers that still
       render it. */
    const failure = new Error(err?.message || 'Request failed');
    failure.status = 0;
    failure.code = err instanceof TypeError ? 'network' : 'unknown';
    failure.cause = err;
    throw failure;
  }
}
