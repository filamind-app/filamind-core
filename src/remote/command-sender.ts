// The SENDER side of the cross-surface command bus. Moonraker only lets connections that
// identified as type:"agent" call connection.send_event, so the command bus rides its OWN
// lightweight agent connection — separate from a surface's main data session (which stays its
// honest type, e.g. "web"). One CommandSender owns exactly one agent Connector.
//
// It is deliberately a second connection rather than relabelling the data session as an agent:
// that keeps the data session (and its tests) untouched, isolates faults (a data-session blip
// can't drop the bus identity and vice-versa), and keeps the surface honest in
// server.extensions.list. The receiver side needs no agent identity (see ./commands).

import type { Connector } from '../moonraker/connector'
import { Logger, NULL_LOGGER } from '../observability/logger'
import {
  FILAMIND_COMMAND_EVENT,
  type RemoteCommand,
  type RemoteView,
  type RemoteMessageLevel,
} from './commands'

export interface CommandSenderOptions {
  /** Stable agent name (pinned — a drifting name registers phantom duplicates on reconnect). */
  client_name: string
  version: string
  /** Required: Moonraker documents `url` as mandatory for identify; omitting it can make a strict
   *  host reject the agent identify, silently stranding the bus. */
  url: string
  logger?: Logger
  /** Fires whenever readiness flips (connected+identified) — lets a UI gate its send affordances. */
  onReadyChange?: (ready: boolean) => void
}

export class CommandSender {
  private identified = false
  private identifying?: Promise<void>
  private _ready = false
  private retryTimer?: ReturnType<typeof setTimeout>
  private retryDelayMs = 500
  private readonly log: Logger

  constructor(
    private readonly connector: Connector,
    private readonly opts: CommandSenderOptions,
  ) {
    this.log = opts.logger ?? NULL_LOGGER
    connector.setCallbacks({
      // Moonraker forgets the agent identity on disconnect → re-identify on every genuine reconnect.
      onReconnected: () => {
        this.setIdentified(false)
        void this.ensureIdentified().catch(() => this.scheduleRetry())
      },
      onConnectProgress: (s) => {
        if (s === 'reconnecting' || s === 'closed') this.setIdentified(false)
        else this.refreshReady() // e.g. back to 'ready' before re-identify completes
      },
      onError: (e) => this.log.warn('command-bus connector error', e.message),
    })
  }

  /** true only when the bus is connected AND identified — gate remote-control affordances on this. */
  get ready(): boolean {
    return this._ready
  }

  /** Open the agent connection and identify once. Call alongside the app's main session start. */
  async start(): Promise<void> {
    await this.connector.connect()
    await this.ensureIdentified().catch(() => this.scheduleRetry())
  }

  /** Close the agent connection (call on app teardown so the socket doesn't linger). */
  stop(): void {
    this.clearRetry()
    this.connector.close()
    this.setIdentified(false)
  }

  /** Broadcast a UI-only command to the other FilaMind surfaces. Best-effort: a command issued
   *  while the bus is down is dropped (logged), never queued/replayed — a stale "navigate" fired
   *  minutes later would yank a screen unexpectedly. */
  async send(cmd: RemoteCommand): Promise<void> {
    if (this.connector.state !== 'ready') {
      this.log.warn('command bus not ready; dropping command', cmd.kind)
      return
    }
    try {
      await this.ensureIdentified()
      await this.connector.call('connection.send_event', { event: FILAMIND_COMMAND_EVENT, data: cmd })
    } catch (e) {
      this.log.warn('command send failed', String(e))
    }
  }

  navigate(view: RemoteView): Promise<void> {
    return this.send({ kind: 'navigate', view })
  }
  message(level: RemoteMessageLevel, text: string): Promise<void> {
    return this.send({ kind: 'message', level, text })
  }
  locate(): Promise<void> {
    return this.send({ kind: 'locate' })
  }

  /** Identify as an agent once per connection; single-flight so concurrent sends don't double-identify. */
  private ensureIdentified(): Promise<void> {
    if (this.identified) return Promise.resolve()
    if (this.identifying) return this.identifying
    this.identifying = this.connector
      .call('server.connection.identify', {
        client_name: this.opts.client_name,
        version: this.opts.version,
        type: 'agent',
        url: this.opts.url,
      })
      .then(() => {
        this.setIdentified(true)
      })
      .finally(() => {
        this.identifying = undefined
      })
    return this.identifying
  }

  private setIdentified(v: boolean): void {
    this.identified = v
    if (v) {
      this.retryDelayMs = 500 // reset the backoff once we're identified
      this.clearRetry()
    }
    this.refreshReady()
  }

  /** Self-heal a transient identify failure while the socket stays up (Moonraker busy during a
   *  klippy/print transition can time out identify without dropping the connection). Bounded backoff;
   *  a genuine reconnect re-drives identify on its own, so we only retry while state is 'ready'. */
  private scheduleRetry(): void {
    if (this.retryTimer || this.identified) return
    if (this.connector.state !== 'ready') return
    const delay = this.retryDelayMs
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 10_000)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      if (this.connector.state === 'ready' && !this.identified) {
        void this.ensureIdentified().catch(() => this.scheduleRetry())
      }
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  /** Recompute readiness (connected + identified) and notify on change. */
  private refreshReady(): void {
    const r = this.connector.state === 'ready' && this.identified
    if (r !== this._ready) {
      this._ready = r
      this.opts.onReadyChange?.(r)
    }
  }
}
