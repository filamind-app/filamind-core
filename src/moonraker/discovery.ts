// F16 - zero-config Moonraker endpoint discovery. Derives candidate ws(s)://…/websocket URLs
// from the current page origin (same-origin reverse-proxy, the direct :7125 port, localhost)
// and races short-lived probe sockets, resolving with the first that opens. A runtime override
// always wins. The socket is injectable (wsFactory) so this is fully testable without a real WS.

import type { WebSocketLike } from './client'

const defaultWsFactory = (url: string): WebSocketLike =>
  new WebSocket(url) as unknown as WebSocketLike

/** A minimal view of `location` - the DOM Location satisfies it; tests pass a plain object. */
export interface LocationLike {
  protocol?: string
  hostname?: string
}

export interface DiscoveryOptions {
  /** Explicit runtime override (e.g. from settings). If set, it wins immediately - no probing. */
  override?: string
  /** Candidate ws(s):// URLs to race. If omitted, they are derived from `location`. */
  candidates?: string[]
  /** Overall budget before discovery gives up (ms). Default 3000. */
  timeoutMs?: number
  /** Injectable socket factory (tests / non-DOM). Default: `new WebSocket`. */
  wsFactory?: (url: string) => WebSocketLike
  /** Source for deriving candidates. Default: `globalThis.location`. */
  location?: LocationLike
}

/**
 * Ordered, de-duplicated candidate endpoints:
 *  1. same-origin `/websocket` (the suite deploy reverse-proxies Moonraker here),
 *  2. the page host on Moonraker's default `:7125` (direct, no proxy),
 *  3. `localhost:7125` (on-printer / Tauri webview, whose origin is `tauri.localhost`).
 */
export function deriveCandidates(location?: LocationLike): string[] {
  const loc = location ?? (globalThis as { location?: LocationLike }).location ?? {}
  const wsProto = loc.protocol === 'https:' ? 'wss' : 'ws'
  const host = loc.hostname && loc.hostname.length > 0 ? loc.hostname : 'localhost'
  return [
    ...new Set([
      `${wsProto}://${host}/websocket`,
      `${wsProto}://${host}:7125/websocket`,
      `ws://localhost:7125/websocket`,
    ]),
  ]
}

/**
 * Resolve a reachable Moonraker WebSocket URL. `override` wins immediately; otherwise the
 * candidates are raced and the first socket to open wins (the rest are closed). Rejects if
 * none open within `timeoutMs`.
 */
export function resolveMoonrakerUrl(opts: DiscoveryOptions = {}): Promise<string> {
  const override = opts.override?.trim()
  if (override) return Promise.resolve(override)

  const candidates = opts.candidates ?? deriveCandidates(opts.location)
  if (candidates.length === 0) {
    return Promise.reject(new Error('moonraker discovery: no candidate endpoints'))
  }
  const makeWs = opts.wsFactory ?? defaultWsFactory
  const timeoutMs = opts.timeoutMs ?? 3000

  return new Promise<string>((resolve, reject) => {
    let settled = false
    let remaining = candidates.length
    const sockets: WebSocketLike[] = []
    const timer = setTimeout(finishFail, timeoutMs)

    function cleanup(): void {
      clearTimeout(timer)
      for (const s of sockets) {
        s.onopen = null
        s.onerror = null
        s.onclose = null
        try {
          s.close()
        } catch {
          /* a probe socket may already be closing; ignore */
        }
      }
    }
    function finishOk(url: string): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(url)
    }
    function finishFail(): void {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`moonraker discovery: no endpoint responded (${candidates.join(', ')})`))
    }
    function lose(): void {
      remaining -= 1
      if (remaining <= 0) finishFail()
    }

    for (const url of candidates) {
      let s: WebSocketLike
      try {
        s = makeWs(url)
      } catch {
        lose()
        continue
      }
      sockets.push(s)
      let done = false
      const fail = (): void => {
        if (!done) {
          done = true
          lose()
        }
      }
      s.onopen = () => finishOk(url)
      s.onerror = fail
      s.onclose = fail
    }
  })
}
