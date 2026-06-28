import { describe, it, expect } from 'vitest'
import { FilaMindSession } from '../session/session'
import type {
  Connector,
  ConnectorCallbacks,
  ConnectionState,
  SubscriptionMap,
} from '../moonraker/connector'

/** A scriptable in-memory Connector for driving the session through its lifecycle. */
class FakeConnector implements Connector {
  state: ConnectionState = 'idle'
  cb: ConnectorCallbacks = {}
  calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  responses: Record<string, unknown | ((p?: Record<string, unknown>) => unknown)> = {}
  subscribed: SubscriptionMap | null = null
  connectCount = 0

  setCallbacks(cb: ConnectorCallbacks): void {
    this.cb = cb
  }
  async connect(): Promise<void> {
    this.connectCount++
    this.state = 'ready'
  }
  close(): void {
    this.state = 'closed'
  }
  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    const r = this.responses[method]
    const v = typeof r === 'function' ? (r as (p?: Record<string, unknown>) => unknown)(params) : r
    return v as T
  }
  async subscribe(objects: SubscriptionMap): Promise<void> {
    this.subscribed = objects
  }
  async upload(): Promise<void> {}
  async download(): Promise<Blob> {
    return new Blob()
  }

  // test helpers
  emit(method: string, params: unknown): void {
    this.cb.onUpdate?.(method, params)
  }
  progress(s: ConnectionState): void {
    this.cb.onConnectProgress?.(s)
  }
  reconnected(): void {
    this.cb.onReconnected?.()
  }
}

const ready = (extruderTemp = 200) => ({
  'server.info': { klippy_state: 'ready', components: ['file_manager', 'update_manager'] },
  'printer.objects.query': { status: { extruder: { temperature: extruderTemp, target: 0 } } },
})

describe('FilaMindSession bootstrap', () => {
  it('stages init when Klippy is ready > live, capabilities, seeded, subscribed', async () => {
    const c = new FakeConnector()
    c.responses = ready(205)
    const s = new FilaMindSession(c, { subscriptions: { extruder: ['temperature'] } })
    await s.start()

    expect(c.connectCount).toBe(1)
    expect(s.live.value).toBe(true)
    expect(s.klippy.value).toBe('ready')
    expect(s.capabilities.value).toContain('update_manager')
    expect((s.printer.objects.value.extruder as { temperature: number }).temperature).toBe(205)
    expect(c.subscribed).toEqual({ extruder: ['temperature'] })
  })

  it('does NOT go live when Klippy is not ready, then re-bootstraps on notify_klippy_ready', async () => {
    const c = new FakeConnector()
    const infoSeq = [
      { klippy_state: 'startup', components: [] },
      { klippy_state: 'ready', components: ['x'] },
    ]
    c.responses = {
      'server.info': () => infoSeq.shift(),
      'printer.objects.query': { status: { extruder: { temperature: 30 } } },
    }
    const s = new FilaMindSession(c)
    await s.start()

    expect(s.live.value).toBe(false)
    expect(s.klippy.value).toBe('startup')
    expect(c.subscribed).toBeNull() // never queried/subscribed while not ready

    c.emit('notify_klippy_ready', null)
    await new Promise((r) => setTimeout(r, 0)) // let the async re-bootstrap settle
    expect(s.klippy.value).toBe('ready')
    expect(s.live.value).toBe(true)
    expect(c.subscribed).not.toBeNull()
  })
})

describe('FilaMindSession runtime routing', () => {
  it('routes notify_status_update into the printer model', async () => {
    const c = new FakeConnector()
    c.responses = ready()
    const s = new FilaMindSession(c)
    await s.start()

    c.emit('notify_status_update', [{ extruder: { temperature: 245 } }])
    s.printer.flush() // bypass the 1s coalescing window for the assertion
    expect((s.printer.objects.value.extruder as { temperature: number }).temperature).toBe(245)
  })

  it('drops live on shutdown / disconnect and on reconnecting progress', async () => {
    const c = new FakeConnector()
    c.responses = ready()
    const s = new FilaMindSession(c)
    await s.start()
    expect(s.live.value).toBe(true)

    c.emit('notify_klippy_shutdown', null)
    expect(s.klippy.value).toBe('shutdown')
    expect(s.live.value).toBe(false)

    // back to live, then a reconnecting transition must also dim
    c.emit('notify_klippy_ready', null)
    await new Promise((r) => setTimeout(r, 0))
    expect(s.live.value).toBe(true)
    c.progress('reconnecting')
    expect(s.live.value).toBe(false)
  })

  it('parses a Klipper prompt sequence into a structured dialog', async () => {
    const c = new FakeConnector()
    c.responses = ready()
    const s = new FilaMindSession(c)
    await s.start()

    c.emit('notify_gcode_response', ['// action:prompt_begin Heat soak?'])
    c.emit('notify_gcode_response', ['// action:prompt_text Bed must reach 60C'])
    c.emit('notify_gcode_response', ['// action:prompt_button Continue|RESUME|primary'])
    c.emit('notify_gcode_response', ['// action:prompt_show'])

    const ev = s.prompt.value
    expect(ev?.type).toBe('show')
    if (ev?.type === 'show') {
      expect(ev.dialog.title).toBe('Heat soak?')
      expect(ev.dialog.text).toEqual(['Bed must reach 60C'])
      expect(ev.dialog.buttons[0]).toEqual({ label: 'Continue', gcode: 'RESUME', style: 'primary' })
    }

    c.emit('notify_gcode_response', ['// action:prompt_end'])
    expect(s.prompt.value?.type).toBe('end')
  })

  it('surfaces notify_agent_event to onAgentEvent (discrete, parsed, malformed dropped)', async () => {
    const c = new FakeConnector()
    c.responses = ready()
    const seen: Array<{ agent: string; event: string; data?: unknown }> = []
    const s = new FilaMindSession(c, { onAgentEvent: (ev) => void seen.push(ev) })
    await s.start()

    c.emit('notify_agent_event', [
      { agent: 'FilaMind 3d', event: 'filamind:command', data: { kind: 'navigate', view: 'control' } },
    ])
    c.emit('notify_agent_event', [{ agent: 'x' }]) // malformed (no event) > dropped

    expect(seen).toEqual([
      { agent: 'FilaMind 3d', event: 'filamind:command', data: { kind: 'navigate', view: 'control' } },
    ])
  })

  it('stop() closes the connector and dims', async () => {
    const c = new FakeConnector()
    c.responses = ready()
    const s = new FilaMindSession(c)
    await s.start()
    s.stop()
    expect(c.state).toBe('closed')
    expect(s.live.value).toBe(false)
  })
})
