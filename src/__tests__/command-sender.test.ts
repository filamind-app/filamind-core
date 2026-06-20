import { describe, it, expect, vi } from 'vitest'
import { CommandSender } from '../remote/command-sender'
import { FILAMIND_COMMAND_EVENT } from '../remote/commands'
import type {
  Connector,
  ConnectorCallbacks,
  ConnectionState,
  SubscriptionMap,
} from '../moonraker/connector'

/** Minimal scriptable Connector for the command bus: records calls, immediate-resolves. */
class FakeBus implements Connector {
  state: ConnectionState = 'idle'
  cb: ConnectorCallbacks = {}
  calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  subscribeCount = 0
  identifyFailures = 0 // make the next N identify calls reject (transient-failure simulation)

  setCallbacks(cb: ConnectorCallbacks): void {
    this.cb = cb
  }
  async connect(): Promise<void> {
    this.state = 'ready'
  }
  close(): void {
    this.state = 'closed'
  }
  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'server.connection.identify' && this.identifyFailures > 0) {
      this.identifyFailures--
      throw new Error('identify failed')
    }
    return (method === 'connection.send_event' ? 'ok' : { connection_id: 1 }) as T
  }
  async subscribe(_objects: SubscriptionMap): Promise<void> {
    this.subscribeCount++
  }
  async upload(): Promise<void> {}
  async download(): Promise<Blob> {
    return new Blob()
  }

  // helpers
  methods(): string[] {
    return this.calls.map((c) => c.method)
  }
  progress(s: ConnectionState): void {
    this.state = s
    this.cb.onConnectProgress?.(s)
  }
  reconnected(): void {
    this.state = 'ready'
    this.cb.onReconnected?.()
  }
}

const opts = { client_name: 'FilaMind 3d', version: '1.2.3', url: 'http://x' }

describe('CommandSender', () => {
  it('start() identifies as an agent with the pinned name/version', async () => {
    const bus = new FakeBus()
    const s = new CommandSender(bus, opts)
    await s.start()

    const identify = bus.calls.find((c) => c.method === 'server.connection.identify')
    expect(identify?.params).toMatchObject({ client_name: 'FilaMind 3d', version: '1.2.3', type: 'agent' })
    expect(s.ready).toBe(true)
  })

  it('send() emits connection.send_event ONLY after identify, with the command as data', async () => {
    const bus = new FakeBus()
    const s = new CommandSender(bus, opts)
    await s.start()
    await s.navigate('control')

    const order = bus.methods()
    expect(order.indexOf('server.connection.identify')).toBeLessThan(order.indexOf('connection.send_event'))
    const sent = bus.calls.find((c) => c.method === 'connection.send_event')
    expect(sent?.params).toEqual({
      event: FILAMIND_COMMAND_EVENT,
      data: { kind: 'navigate', view: 'control' },
    })
  })

  it('convenience helpers build the right command union', async () => {
    const bus = new FakeBus()
    const s = new CommandSender(bus, opts)
    await s.start()
    await s.message('warn', 'check the bed')
    await s.locate()

    const datas = bus.calls.filter((c) => c.method === 'connection.send_event').map((c) => c.params?.data)
    expect(datas).toEqual([
      { kind: 'message', level: 'warn', text: 'check the bed' },
      { kind: 'locate' },
    ])
  })

  it('re-identifies on reconnect (Moonraker forgets agent identity on drop)', async () => {
    const bus = new FakeBus()
    const s = new CommandSender(bus, opts)
    await s.start()
    expect(bus.calls.filter((c) => c.method === 'server.connection.identify')).toHaveLength(1)

    bus.progress('reconnecting') // identity dropped
    expect(s.ready).toBe(false)
    bus.reconnected() // genuine reconnect → re-identify
    await new Promise((r) => setTimeout(r, 0))
    expect(bus.calls.filter((c) => c.method === 'server.connection.identify')).toHaveLength(2)
    expect(s.ready).toBe(true)
  })

  it('drops a command (no send_event) when the bus is not ready', async () => {
    const bus = new FakeBus()
    const s = new CommandSender(bus, opts)
    // never started; state is 'idle'
    await s.locate()
    expect(bus.methods()).not.toContain('connection.send_event')
  })

  it('single-flights identify under concurrent sends', async () => {
    const bus = new FakeBus()
    const s = new CommandSender(bus, opts)
    await bus.connect() // ready but not yet identified
    await Promise.all([s.locate(), s.navigate('status'), s.navigate('settings')])

    expect(bus.calls.filter((c) => c.method === 'server.connection.identify')).toHaveLength(1)
    expect(bus.calls.filter((c) => c.method === 'connection.send_event')).toHaveLength(3)
  })

  it('never subscribes to printer objects (it is a pure command bus)', async () => {
    const bus = new FakeBus()
    const s = new CommandSender(bus, opts)
    await s.start()
    await s.navigate('control')
    expect(bus.subscribeCount).toBe(0)
    expect(bus.methods()).not.toContain('printer.objects.subscribe')
  })

  it('fires onReadyChange as the bus goes ready → not-ready → ready', async () => {
    const bus = new FakeBus()
    const flips: boolean[] = []
    const s = new CommandSender(bus, { ...opts, onReadyChange: (r) => void flips.push(r) })
    await s.start()
    bus.progress('reconnecting')
    bus.reconnected()
    await new Promise((r) => setTimeout(r, 0))
    expect(flips).toEqual([true, false, true])
  })

  it('self-heals a transient identify failure via bounded retry (no reconnect needed)', async () => {
    vi.useFakeTimers()
    try {
      const bus = new FakeBus()
      bus.identifyFailures = 1 // first identify rejects, second succeeds
      const s = new CommandSender(bus, opts)
      await s.start() // first identify rejected → retry scheduled
      expect(s.ready).toBe(false)
      await vi.advanceTimersByTimeAsync(600) // backoff (500ms) elapses → retry identifies
      expect(s.ready).toBe(true)
      expect(bus.calls.filter((c) => c.method === 'server.connection.identify')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() closes the connection and clears readiness', async () => {
    const bus = new FakeBus()
    const s = new CommandSender(bus, opts)
    await s.start()
    s.stop()
    expect(bus.state).toBe('closed')
    expect(s.ready).toBe(false)
  })
})
