import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MoonrakerClient, type WebSocketLike } from '../moonraker/client'

/** A hand-driven WebSocket so tests control open/close/message timing. */
class FakeWs implements WebSocketLike {
  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  sent: string[] = []
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.onclose?.()
  }
  open(): void {
    this.onopen?.()
  }
  message(data: string): void {
    this.onmessage?.({ data })
  }
  lastSent(): { id?: number; method?: string } {
    return JSON.parse(this.sent[this.sent.length - 1] ?? '{}')
  }
}

function makeClient() {
  const sockets: FakeWs[] = []
  const client = new MoonrakerClient({
    url: 'ws://x/websocket',
    wsFactory: () => {
      const s = new FakeWs()
      sockets.push(s)
      return s
    },
  })
  return { client, sockets }
}

describe('MoonrakerClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('resolves connect on the first open without signalling a reconnect', async () => {
    const { client, sockets } = makeClient()
    let reconnects = 0
    client.setCallbacks({ onReconnected: () => reconnects++ })
    const p = client.connect()
    sockets[0]!.open()
    await p
    expect(client.state).toBe('ready')
    expect(reconnects).toBe(0) // first open must NOT bootstrap twice
  })

  it('signals onReconnected only on a genuine re-open', async () => {
    const { client, sockets } = makeClient()
    let reconnects = 0
    client.setCallbacks({ onReconnected: () => reconnects++ })
    const p = client.connect()
    sockets[0]!.open()
    await p
    sockets[0]!.close() // drop > schedules a backoff reconnect
    await vi.runOnlyPendingTimersAsync() // fire the timer > a fresh connect()
    sockets[1]!.open()
    expect(reconnects).toBe(1)
  })

  it('correlates a request to its response by id', async () => {
    const { client, sockets } = makeClient()
    const p = client.connect()
    sockets[0]!.open()
    await p
    const req = client.call<{ ok: boolean }>('server.info')
    const id = sockets[0]!.lastSent().id
    sockets[0]!.message(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } }))
    await expect(req).resolves.toEqual({ ok: true })
  })

  it('rejects all in-flight requests when the socket closes', async () => {
    const { client, sockets } = makeClient()
    const p = client.connect()
    sockets[0]!.open()
    await p
    const req = client.call('printer.gcode.script')
    sockets[0]!.close()
    await expect(req).rejects.toThrow(/connection closed/)
  })

  it('close() during reconnect backoff cancels the pending reconnect (no new socket)', async () => {
    const { client, sockets } = makeClient()
    const p = client.connect()
    sockets[0]!.open()
    await p
    sockets[0]!.close() // drop > schedules a backoff reconnect
    expect(client.state).toBe('reconnecting')
    client.close() // user closes during the backoff window
    expect(client.state).toBe('closed')
    await vi.runOnlyPendingTimersAsync() // the (now-cancelled) timer would have fired here
    expect(sockets).toHaveLength(1) // no second socket was ever opened
    expect(client.state).toBe('closed')
  })
})
