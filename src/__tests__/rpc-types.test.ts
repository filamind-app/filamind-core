import { describe, it, expect } from 'vitest'
import { RpcError, parseNotifyEvent } from '../moonraker/rpc-types'
import { MoonrakerClient, type WebSocketLike } from '../moonraker/client'

describe('RpcError', () => {
  it('preserves the JSON-RPC code and data and is an Error', () => {
    const e = new RpcError('bad', -32601, { hint: 'no such method' })
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('RpcError')
    expect(e.message).toBe('bad')
    expect(e.code).toBe(-32601)
    expect(e.data).toEqual({ hint: 'no such method' })
  })
})

describe('parseNotifyEvent', () => {
  it('narrows notify_status_update positional params', () => {
    const ev = parseNotifyEvent('notify_status_update', [{ extruder: { temperature: 200 } }, 12.5])
    expect(ev).toEqual({
      method: 'notify_status_update',
      status: { extruder: { temperature: 200 } },
      eventtime: 12.5,
    })
  })

  it('narrows notify_gcode_response', () => {
    expect(parseNotifyEvent('notify_gcode_response', ['// hello'])).toEqual({
      method: 'notify_gcode_response',
      response: '// hello',
    })
  })

  it('handles the bare klippy lifecycle events', () => {
    expect(parseNotifyEvent('notify_klippy_ready', [])).toEqual({ method: 'notify_klippy_ready' })
    expect(parseNotifyEvent('notify_klippy_shutdown', [])).toEqual({
      method: 'notify_klippy_shutdown',
    })
    expect(parseNotifyEvent('notify_klippy_disconnected', [])).toEqual({
      method: 'notify_klippy_disconnected',
    })
  })

  it('narrows notify_agent_event', () => {
    expect(
      parseNotifyEvent('notify_agent_event', [{ agent: 'FilaMind 3d', event: 'navigate', data: { view: 'status' } }]),
    ).toEqual({
      method: 'notify_agent_event',
      agent: 'FilaMind 3d',
      event: 'navigate',
      data: { view: 'status' },
    })
  })

  it('returns null for unknown methods and tolerates malformed params', () => {
    expect(parseNotifyEvent('notify_something_else', [1, 2])).toBeNull()
    expect(parseNotifyEvent('notify_status_update', undefined)).toEqual({
      method: 'notify_status_update',
      status: {},
      eventtime: 0,
    })
  })
})

/** A hand-driven socket so the test can deliver an error response frame. */
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
  lastId(): number {
    return JSON.parse(this.sent[this.sent.length - 1] ?? '{}').id
  }
}

describe('MoonrakerClient error response', () => {
  it('rejects a call with an RpcError carrying code + data', async () => {
    let sock: FakeWs | undefined
    const client = new MoonrakerClient({
      url: 'ws://x/websocket',
      wsFactory: () => (sock = new FakeWs()),
    })
    const cp = client.connect()
    sock!.open()
    await cp
    const call = client.call('printer.gcode.script', { script: 'BAD' })
    const id = sock!.lastId()
    sock!.message(
      JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid', data: { x: 1 } } }),
    )
    await expect(call).rejects.toBeInstanceOf(RpcError)
    await call.catch((e: RpcError) => {
      expect(e.code).toBe(-32602)
      expect(e.data).toEqual({ x: 1 })
    })
  })
})
