// FilaMindSession - the orchestrator that wires the isolated core pieces into one
// working connection: staged init (identify > capabilities > query/seed > subscribe),
// routes notify_status_update into the state model, and owns the Klippy lifecycle so a
// FIRMWARE_RESTART re-seeds + re-subscribes (instead of showing stale data as live).

import { Observable } from '../state/observable'
import { PrinterState } from '../state/printer'
import { deriveKlippyState, isKlippyLive, type KlippyState } from '../printer/klippy'
import { PromptParser, type PromptEvent } from '../printer/prompt-parser'
import { FULL_CONTROL } from '../moonraker/subscriptions'
import type { Connector, SubscriptionMap } from '../moonraker/connector'
import { Logger, NULL_LOGGER } from '../observability/logger'
import { parseAgentEvent, type AgentEvent } from '../remote/commands'

export interface IdentifyInfo {
  client_name: string
  version: string
  type: 'web' | 'display' | 'desktop' | 'bot' | 'agent'
  url?: string
  access_token?: string
}

export interface SessionOptions {
  /** the active subscription set (a tier or aggregateSubscriptions(active widgets)) */
  subscriptions?: SubscriptionMap
  identify?: IdentifyInfo
  logger?: Logger
  /** Receive cross-surface agent events (notify_agent_event) - e.g. remote-control commands from
   *  another FilaMind surface. Discrete (fired per event, never replayed), so no stale re-fire. */
  onAgentEvent?: (ev: AgentEvent) => void
}

export class FilaMindSession {
  readonly printer = new PrinterState()
  readonly klippy = new Observable<KlippyState>('disconnected')
  readonly capabilities = new Observable<string[]>([])
  /** true only when data is trustworthy as live (connected + Klippy ready). The UI dims when false. */
  readonly live = new Observable<boolean>(false)
  readonly prompt = new Observable<PromptEvent>(null)

  private subs: SubscriptionMap
  private readonly log: Logger
  private readonly prompts = new PromptParser()
  private bootstrapping = false

  constructor(
    private readonly connector: Connector,
    private readonly opts: SessionOptions = {},
  ) {
    this.subs = opts.subscriptions ?? FULL_CONTROL
    this.log = opts.logger ?? NULL_LOGGER
    connector.setCallbacks({
      onUpdate: (m, p) => this.onUpdate(m, p),
      onConnectProgress: (s) => {
        if (s === 'reconnecting' || s === 'closed') this.setLive(false)
      },
      onReconnected: () => {
        void this.bootstrap()
      },
      onError: (e) => this.log.error('connector error', e.message),
    })
  }

  /** Set/replace the active subscription set (e.g. when the dashboard's widgets change). */
  setSubscriptions(subs: SubscriptionMap): void {
    this.subs = subs
  }

  async start(): Promise<void> {
    await this.connector.connect()
    await this.bootstrap()
  }

  stop(): void {
    this.connector.close()
    this.setLive(false)
  }

  /** Staged init - runs on first connect AND on reconnect AND on notify_klippy_ready.
   *  Guarded so overlapping triggers (reconnect + klippy_ready) can't interleave two seeds. */
  private async bootstrap(): Promise<void> {
    if (this.bootstrapping) return
    this.bootstrapping = true
    try {
      if (this.opts.identify) {
        await this.connector.call('server.connection.identify', { ...this.opts.identify }).catch((e) =>
          this.log.warn('identify failed', String(e)),
        )
      }
      const info = await this.connector.call<{ klippy_state?: string; components?: string[] }>('server.info')
      this.capabilities.set(info?.components ?? [])
      const ks = deriveKlippyState(info?.klippy_state)
      this.klippy.set(ks)
      if (!isKlippyLive(ks)) {
        this.setLive(false)
        return // Klipper not ready - no objects to query yet; wait for notify_klippy_ready
      }
      const q = await this.connector.call<{ status?: Record<string, Record<string, unknown>> }>(
        'printer.objects.query',
        { objects: this.subs },
      )
      this.printer.seed(q?.status ?? {})
      await this.connector.subscribe(this.subs)
      this.setLive(true)
    } catch (e) {
      this.log.error('bootstrap failed', String(e))
      this.setLive(false)
    } finally {
      this.bootstrapping = false
    }
  }

  private onUpdate(method: string, params: unknown): void {
    switch (method) {
      case 'notify_status_update':
        this.printer.applyNotify(params)
        break
      case 'notify_klippy_ready':
        this.klippy.set('ready')
        void this.bootstrap() // re-seed + re-subscribe even though the WS never dropped
        break
      case 'notify_klippy_shutdown':
        this.klippy.set('shutdown')
        this.setLive(false)
        break
      case 'notify_klippy_disconnected':
        this.klippy.set('disconnected')
        this.setLive(false)
        break
      case 'notify_gcode_response':
        this.handleGcodeResponse(params)
        break
      case 'notify_agent_event': {
        const ev = parseAgentEvent(params)
        if (ev && this.opts.onAgentEvent) this.opts.onAgentEvent(ev)
        break
      }
    }
  }

  private handleGcodeResponse(params: unknown): void {
    const line = Array.isArray(params) ? String(params[0]) : String(params)
    const ev = this.prompts.feed(line)
    if (ev) this.prompt.set(ev)
  }

  private setLive(v: boolean): void {
    if (this.live.value !== v) this.live.set(v)
  }
}
