export function createApiClient(base = '', fetcher = globalThis.fetch) {
  const origin = base.trim().replace(/\/$/, '');
  if (origin) {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('VITE_API_URL must be an HTTP(S) origin without a path.');
    }
  }
  return async function api(path, { body, ...options } = {}) {
    const response = await fetcher(origin + '/api' + path, {
      ...options,
      credentials: 'include',
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || 'Cannot reach the server. Please try again.');
      error.status = response.status;
      throw error;
    }
    if (response.status !== 204 && payload === null) throw new Error('The API returned an invalid response. Check VITE_API_URL and redeploy the client.');
    return payload;
  };
}
