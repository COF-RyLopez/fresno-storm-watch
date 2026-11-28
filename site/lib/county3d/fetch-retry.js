/** fetch() with retries for the county 3D tiles. The public r2.dev bucket rate-limits bursts with HTTP 429, and a tile that
 *  failed once used to stay blank, so 429, 5xx (except 501) and network errors are retried with exponential backoff and
 *  jitter, honouring Retry-After. 4xx other than 408 and 429 (a missing tile, a CORS refusal) fail at once. */

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** Seconds or an HTTP date in Retry-After -> milliseconds from now, or null. */
export function retryAfterMs(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const s = Number(value);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(value);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/** Delay before retry `attempt` (0-based): base * 2^attempt with full jitter, capped; Retry-After wins when longer. */
export function backoffMs(attempt, { baseDelay = 500, maxDelay = 15_000, retryAfter = null, random = Math.random } = {}) {
  const exp = Math.min(maxDelay, baseDelay * 2 ** attempt), jittered = exp / 2 + random() * (exp / 2);
  return retryAfter != null ? Math.min(maxDelay * 2, Math.max(retryAfter, jittered)) : jittered;
}

/**
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @param {{retries?: number, baseDelay?: number, maxDelay?: number, fetchImpl?: typeof fetch,
 *          sleep?: (ms: number) => Promise<void>, random?: () => number, onRetry?: (info: {attempt: number, delay: number, status?: number, error?: Error}) => void}} [options]
 * @returns {Promise<Response>} the first ok response; throws with `.status` set when the last reply was an HTTP error
 */
export async function fetchWithRetry(url, init, { retries = 4, baseDelay = 500, maxDelay = 15_000, fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)), random = Math.random, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    let response, error;
    try { response = await fetchImpl(url, init); } catch (e) {
      if (e?.name === 'AbortError') throw e;
      error = e; // network error, or a CORS-less 429 that the browser reports as TypeError
    }
    if (response?.ok) return response;
    if (response && !RETRYABLE.has(response.status)) throw Object.assign(Error(`HTTP ${response.status}`), { status: response.status });
    if (attempt >= retries) {
      if (response) throw Object.assign(Error(`HTTP ${response.status} after ${retries + 1} tries`), { status: response.status });
      throw error;
    }
    const delay = backoffMs(attempt, { baseDelay, maxDelay, random, retryAfter: retryAfterMs(response?.headers?.get?.('retry-after')) });
    onRetry?.({ attempt, delay, status: response?.status, error });
    await sleep(delay);
  }
}
