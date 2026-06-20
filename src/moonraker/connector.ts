// The backend-agnostic transport seam. Moonraker is the first-class implementation;
// a remote-tunnel or other backend can slot in later without the UI knowing.

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'identifying'
  | 'ready'
  | 'reconnecting'
  | 'closed'

export interface ConnectorCallbacks {
  /** notify_* fan-out (e.g. notify_status_update, notify_gcode_response) */
  onUpdate?: (method: string, params: unknown) => void
  onConnectProgress?: (state: ConnectionState) => void
  onError?: (err: Error) => void
  onReconnected?: () => void
}

/** Objects subscription map: { "<object>": ["<field>", ...] | null } (null = all fields). */
export type SubscriptionMap = Record<string, string[] | null>

export interface Connector {
  readonly state: ConnectionState
  connect(): Promise<void>
  close(): void
  /** JSON-RPC request/response. */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Subscribe to printer objects; the impl remembers the set and restores it on reconnect. */
  subscribe(objects: SubscriptionMap): Promise<void>
  upload(root: string, file: File, onProgress?: (pct: number) => void): Promise<void>
  download(path: string): Promise<Blob>
  setCallbacks(cb: ConnectorCallbacks): void
}
