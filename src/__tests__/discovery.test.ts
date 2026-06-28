import { describe, it, expect, vi } from 'vitest'
import { deriveCandidates, resolveMoonrakerUrl } from '../moonraker/discovery'
import type { WebSocketLike } from '../moonraker/client'

/** A hand-driven probe socket so tests decide which candidate "opens". */
class FakeWs implements WebSocketLike {
  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  closed = false
  constructor(readonly url: string) {}
  send(): void {}
  close(): void {
    this.closed = true
  }
  open(): void {
    this.onopen?.()
  }
  error(): void {
    this.onerror?.()
  }
}

function factory() {
  const sockets: FakeWs[] = []
  const wsFactory = (url: string): WebSocketLike => {
    const s = new FakeWs(url)
    sockets.push(s)
    return s
  }
  return { sockets, wsFactory }
}

describe('deriveCandidates', () => {
  it('derives same-origin, direct-port, and localhost candidates (http > ws)', () => {
    expect(deriveCandidates({ protocol: 'http:', hostname: 'printer.local' })).toEqual([
      'ws://printer.local/websocket',
      'ws://printer.local:7125/websocket',
      'ws://localhost:7125/websocket',
    ])
  })

  it('uses wss when the page is https', () => {
    expect(deriveCandidates({ protocol: 'https:', hostname: 'printer.local' })[0]).toBe(
      'wss://printer.local/websocket',
    )
  })

  it('falls back to localhost when there is no hostname', () => {
    expect(deriveCandidates({})).toContain('ws://localhost:7125/websocket')
  })
})

describe('resolveMoonrakerUrl', () => {
  it('returns the override immediately without probing', async () => {
    const { sockets, wsFactory } = factory()
    await expect(
      resolveMoonrakerUrl({ override: 'ws://manual:7125/websocket', wsFactory }),
    ).resolves.toBe('ws://manual:7125/websocket')
    expect(sockets).toHaveLength(0)
  })

  it('resolves with the first candidate that opens and closes the rest', async () => {
    const { sockets, wsFactory } = factory()
    const candidates = ['ws://a/websocket', 'ws://b/websocket', 'ws://c/websocket']
    const p = resolveMoonrakerUrl({ candidates, wsFactory })
    expect(sockets).toHaveLength(3)
    sockets[1]!.open()
    await expect(p).resolves.toBe('ws://b/websocket')
    expect(sockets[0]!.closed).toBe(true)
    expect(sockets[2]!.closed).toBe(true)
  })

  it('rejects when every candidate fails', async () => {
    const { sockets, wsFactory } = factory()
    const p = resolveMoonrakerUrl({ candidates: ['ws://a/websocket', 'ws://b/websocket'], wsFactory })
    sockets[0]!.error()
    sockets[1]!.error()
    await expect(p).rejects.toThrow(/no endpoint responded/)
  })

  it('rejects after the timeout when nothing opens', async () => {
    vi.useFakeTimers()
    const { wsFactory } = factory()
    const p = resolveMoonrakerUrl({ candidates: ['ws://a/websocket'], wsFactory, timeoutMs: 1000 })
    const assertion = expect(p).rejects.toThrow(/no endpoint responded/)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    vi.useRealTimers()
  })

  it('rejects when there are no candidates', async () => {
    await expect(resolveMoonrakerUrl({ candidates: [] })).rejects.toThrow(/no candidate/)
  })
})
