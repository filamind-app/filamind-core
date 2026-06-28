// Provenance-stamped values - the "never lie" core invariant (§12 spine).
// Every value the UI shows can carry where it came from + when, so widgets can
// render it dimmed / struck / disabled when it is stale or unknown.

export type Source = 'live' | 'cache' | 'optimistic' | 'unknown'

export interface Stamped<T> {
  value: T
  /** when this value arrived (ms epoch, client clock - Moonraker has no server timestamp) */
  ts: number
  source: Source
  /** ms after `ts` when the value should be treated as stale (omit = never goes stale on its own) */
  staleAfter?: number
}

export function stamp<T>(
  value: T,
  source: Source = 'live',
  staleAfter?: number,
  now: number = Date.now(),
): Stamped<T> {
  return staleAfter == null ? { value, ts: now, source } : { value, ts: now, source, staleAfter }
}

export const UNKNOWN: Stamped<undefined> = { value: undefined, ts: 0, source: 'unknown' }

export function isStale(s: Stamped<unknown> | undefined, now: number = Date.now()): boolean {
  if (!s || s.source === 'unknown') return true
  if (s.staleAfter == null) return false
  return now - s.ts > s.staleAfter
}

/** UI hint a widget can map to a class: 'ok' | 'stale' | 'unknown'. */
export function freshness(s: Stamped<unknown> | undefined, now: number = Date.now()): 'ok' | 'stale' | 'unknown' {
  if (!s || s.source === 'unknown') return 'unknown'
  return isStale(s, now) ? 'stale' : 'ok'
}
