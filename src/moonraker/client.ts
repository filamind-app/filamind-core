// Reconnecting Moonraker JSON-RPC 2.0 client over one WebSocket + a REST file channel.
// id-correlated requests · per-request timeout · reject-all-on-close · notify_* fan-out ·
// backoff+jitter reconnect with a max-attempts terminal state · re-subscribe on reconnect.
// The WebSocket is injectable (wsFactory) so tests can drive reconnect/coalescing.

import type {
  Connector,
  ConnectorCallbacks,
  ConnectionState,
  SubscriptionMap,
} from './connector'
import type { Logger } from '../observability/logger'
import { RpcError, type MoonrakerMethods } from './rpc-types'

/** Minimal WebSocket surface the client uses — the DOM WebSocket satisfies it; tests fake it. */
export interface WebSocketLike {
  send(data: string): void
  close(): void
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev?: unknown) => void) | null
  onclose: ((ev?: unknown) => void) | null
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface MoonrakerClientOptions {
  /** ws(s)://host:port/websocket */
  url: string
  requestTimeoutMs?: number
  maxBackoffMs?: number
  /** stop reconnecting after this many consecutive attempts → terminal 'closed' (default: unlimited) */
  maxReconnectAttempts?: number
  wsFactory?: (url: string) => WebSocketLike
  logger?: Logger
}

const defaultWsFactory = (url: string): WebSocketLike =>
  new WebSocket(url) as unknown as WebSocketLike

export class MoonrakerClient implements Connector {
  private ws?: WebSocketLike
  private _state: ConnectionState = 'idle'
  private nextId = 1
  private pending = new Map<number, Pending>()
  private cb: ConnectorCallbacks = {}
  private subs: SubscriptionMap = {}
  private backoff = 1000
  private reconnectAttempts = 0
  private closedByUser = false
  private hasOpened = false
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private readonly makeWs: (url: string) => WebSocketLike

  constructor(private readonly opts: MoonrakerClientOptions) {
    this.makeWs = opts.wsFactory ?? defaultWsFactory
  }

  get state(): ConnectionState {
    return this._state
  }

  setCallbacks(cb: ConnectorCallbacks): void {
    this.cb = cb
  }

  connect(): Promise<void> {
    this.closedByUser = false
    return new Promise<void>((resolve) => {
      this.setState('connecting')
      const ws = this.makeWs(this.opts.url)
      this.ws = ws
      ws.onopen = () => {
        this.backoff = 1000
        this.reconnectAttempts = 0
        this.setState('ready')
        this.restoreSubs()
        // Only signal a RE-connect — the first open is driven by connect()/start() directly,
        // so firing onReconnected here too would bootstrap the session twice concurrently.
        if (this.hasOpened) this.cb.onReconnected?.()
        this.hasOpened = true
        resolve()
      }
      ws.onmessage = (ev) => this.onMessage(String(ev.data))
      ws.onerror = () => this.cb.onError?.(new Error('websocket error'))
      ws.onclose = () => {
        this.failAll(new Error('connection closed'))
        if (this.closedByUser) this.setState('closed')
        else this.scheduleReconnect()
      }
    })
  }

  close(): void {
    this.closedByUser = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.ws?.close()
    // If we were mid-backoff there is no open socket whose onclose will fire → go terminal now.
    if (this._state !== 'ready') this.setState('closed')
  }

  call<M extends keyof MoonrakerMethods>(
    method: M,
    params?: Record<string, unknown>,
  ): Promise<MoonrakerMethods[M]>
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new RpcError(`moonraker request timed out: ${method}`))
      }, this.opts.requestTimeoutMs ?? 10_000)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', method, params, id })
    })
  }

  async subscribe(objects: SubscriptionMap): Promise<void> {
    this.subs = { ...this.subs, ...objects } // union — remembered for reconnect restore
    await this.call('printer.objects.subscribe', { objects })
  }

  // --- REST file channel (the WS carries control/telemetry; binaries go over HTTP) ---
  async upload(root: string, file: File, onProgress?: (pct: number) => void): Promise<void> {
    const form = new FormData()
    form.append('root', root)
    form.append('file', file)
    await xhrUpload(`${this.httpBase()}/server/files/upload`, form, onProgress)
  }

  async download(path: string): Promise<Blob> {
    const res = await fetch(`${this.httpBase()}/server/files/${path}`)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    return res.blob()
  }

  // --- internals ---
  private httpBase(): string {
    return this.opts.url.replace(/^ws/, 'http').replace(/\/websocket\/?$/, '')
  }

  private send(msg: unknown): void {
    this.ws?.send(JSON.stringify(msg))
  }

  private setState(s: ConnectionState): void {
    this._state = s
    this.cb.onConnectProgress?.(s)
  }

  private restoreSubs(): void {
    if (Object.keys(this.subs).length > 0) {
      this.call('printer.objects.subscribe', { objects: this.subs }).catch((e) =>
        this.opts.logger?.warn('restoreSubs failed', String(e)),
      )
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1
    const max = this.opts.maxReconnectAttempts
    if (max !== undefined && this.reconnectAttempts > max) {
      this.opts.logger?.error('reconnect giving up', this.reconnectAttempts)
      this.setState('closed')
      return
    }
    this.setState('reconnecting')
    const jitter = this.backoff * (0.8 + Math.random() * 0.4) // ±20% to de-synchronize storms
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.closedByUser) return // close() landed during the backoff window — don't reopen
      this.connect().catch(() => {})
    }, jitter)
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs ?? 30_000)
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private onMessage(data: string): void {
    let msg: {
      id?: number
      result?: unknown
      error?: { code?: number; message?: string; data?: unknown }
      method?: string
      params?: unknown
    }
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new RpcError(msg.error.message ?? 'rpc error', msg.error.code, msg.error.data))
      else p.resolve(msg.result)
      return
    }
    if (typeof msg.method === 'string') {
      this.cb.onUpdate?.(msg.method, msg.params)
    }
  }
}

function xhrUpload(url: string, form: FormData, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    if (onProgress) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed: ${xhr.status}`))
    xhr.onerror = () => reject(new Error('upload network error'))
    xhr.send(form)
  })
}
