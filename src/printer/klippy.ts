// Klippy lifecycle — distinct from the WebSocket connection state. On FIRMWARE_RESTART
// the socket stays open while Klipper drops + re-registers every object, so a control
// surface MUST track this separately (and re-seed) or it shows stale data as live.

export type KlippyState = 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected'

const KNOWN: ReadonlySet<KlippyState> = new Set<KlippyState>([
  'ready',
  'startup',
  'shutdown',
  'error',
  'disconnected',
])

/** Map a Moonraker `server.info.klippy_state` string to a KlippyState (default: disconnected). */
export function deriveKlippyState(raw: unknown): KlippyState {
  return typeof raw === 'string' && KNOWN.has(raw as KlippyState) ? (raw as KlippyState) : 'disconnected'
}

/** Printer data is trustworthy as "live" only when Klippy is ready. */
export function isKlippyLive(state: KlippyState): boolean {
  return state === 'ready'
}
