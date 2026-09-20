export const API_ROOT = '/api';

export function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

export async function apiFetch(path, options = {}) {
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
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const failure = new Error(payload?.detail || `Request failed with ${response.status}`);
    /* Additive only (task 4.1): callers that must tell a by-design rejection
       (400 on a closed batch) from a real failure read this; the message every
       existing caller surfaces is unchanged. */
    failure.status = response.status;
    throw failure;
  }
  return payload;
}
