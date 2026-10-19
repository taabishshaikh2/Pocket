const abortError = () => new DOMException('Startup cancelled.', 'AbortError');
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const stop = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}
async function request(api, path, timeoutMs, signal) {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  try { return await api(path, { signal: controller.signal, cache: 'no-store' }); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}
export async function loadStartupSession(api, {
  signal, timeoutMs = 180000, requestTimeoutMs = 20000, retryDelayMs = 3000,
  now = Date.now, sleep = delay,
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (signal?.aborted) throw abortError();
    try {
      // This GET wakes the backend through the same-origin gateway.
      const health = await request(api, '/health', Math.min(requestTimeoutMs, deadline - now()), signal);
      if (health?.status !== 'ok') throw new Error('Backend is still starting.');
      if (now() >= deadline) break;
      const session = await request(api, '/auth/me', Math.min(requestTimeoutMs, deadline - now()), signal);
      if (!session || !Object.hasOwn(session, 'user')) throw new Error('Session service is still starting.');
      return session;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      // Retry only startup GETs. Never replay logins, transactions, or other writes.
      if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await sleep(Math.min(retryDelayMs, remaining), signal);
    }
  }
  throw new Error('Pocket is taking longer than usual to start. Please try again in a moment.');
}
