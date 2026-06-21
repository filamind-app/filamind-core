// §18.3 — type safety over the Moonraker JSON-RPC surface:
//  - RpcError preserves the JSON-RPC {code, data} instead of flattening to a bare Error,
//  - MoonrakerMethods types the result of the commonly-used `call()` methods (autocomplete + result shape),
//  - NotifyEvent + parseNotifyEvent turn the positional notify_* params into a discriminated union
//    so consumers narrow by event instead of hand-casting `unknown`.

/** A JSON-RPC error that keeps Moonraker's numeric `code` and optional `data` payload. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

export interface ServerInfo {
  klippy_connected: boolean
  klippy_state: 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected'
  components?: string[]
  warnings?: string[]
  [k: string]: unknown
}

export interface PrinterInfo {
  state: 'ready' | 'startup' | 'shutdown' | 'error'
  state_message: string
  hostname?: string
  software_version?: string
  [k: string]: unknown
}

export interface QueryResult {
  eventtime: number
  status: Record<string, unknown>
}

/** Result types for the methods the suite calls most. Unlisted methods still work via `call<T>()`. */
export interface MoonrakerMethods {
  'server.info': ServerInfo
  'server.connection.identify': { connection_id: number }
  'printer.info': PrinterInfo
  'printer.objects.list': { objects: string[] }
  'printer.objects.query': QueryResult
  'printer.objects.subscribe': QueryResult
  'printer.gcode.script': 'ok'
  'printer.emergency_stop': 'ok'
  'printer.restart': 'ok'
  'printer.firmware_restart': 'ok'
  'machine.system_info': { system_info: Record<string, unknown> }
  'machine.reboot': 'ok'
  'machine.shutdown': 'ok'
  'server.database.get_item': { namespace: string; key?: string; value: unknown }
  'server.database.post_item': { namespace: string; key?: string; value: unknown }
}

/** A narrowed view of Moonraker's `notify_*` broadcasts (whose raw params are positional arrays). */
export type NotifyEvent =
  | { method: 'notify_status_update'; status: Record<string, unknown>; eventtime: number }
  | { method: 'notify_gcode_response'; response: string }
  | { method: 'notify_klippy_ready' }
  | { method: 'notify_klippy_shutdown' }
  | { method: 'notify_klippy_disconnected' }
  | { method: 'notify_agent_event'; agent: string; event: string; data: unknown }

/** Parse a raw (method, params) notify into a typed event, or null for an unhandled method. */
export function parseNotifyEvent(method: string, params: unknown): NotifyEvent | null {
  const arr = Array.isArray(params) ? params : []
  switch (method) {
    case 'notify_status_update':
      return {
        method: 'notify_status_update',
        status: (arr[0] ?? {}) as Record<string, unknown>,
        eventtime: typeof arr[1] === 'number' ? arr[1] : 0,
      }
    case 'notify_gcode_response':
      return {
        method: 'notify_gcode_response',
        response: typeof arr[0] === 'string' ? arr[0] : '',
      }
    case 'notify_klippy_ready':
      return { method: 'notify_klippy_ready' }
    case 'notify_klippy_shutdown':
      return { method: 'notify_klippy_shutdown' }
    case 'notify_klippy_disconnected':
      return { method: 'notify_klippy_disconnected' }
    case 'notify_agent_event': {
      const e = (arr[0] ?? {}) as { agent?: unknown; event?: unknown; data?: unknown }
      return {
        method: 'notify_agent_event',
        agent: typeof e.agent === 'string' ? e.agent : '',
        event: typeof e.event === 'string' ? e.event : '',
        data: e.data,
      }
    }
    default:
      return null
  }
}
