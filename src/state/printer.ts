// One normalized reactive printer-state model, merge-patched from notify_status_update,
// with a per-second coalescing cache + a motion_report fast-path so the reactive layer
// is not thrashed at Klipper's ~250 ms-per-object rate.

import { Observable } from './observable'

export type PrinterObjects = Record<string, Record<string, unknown>>

/** Objects that bypass the 1 s coalescing so live toolhead position stays smooth. */
const FAST_PATH = new Set<string>(['motion_report'])

export class PrinterState {
  readonly objects = new Observable<PrinterObjects>({})
  private pendingPatch: PrinterObjects = {}
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly coalesceMs: number

  constructor(coalesceMs = 1000) {
    this.coalesceMs = coalesceMs
  }

  /** Seed from a printer.objects.query result. */
  seed(objects: PrinterObjects): void {
    this.objects.set(deepMerge({}, objects))
  }

  /** Feed notify_status_update params: `[ { <object>: { <field>: value } }, eventtime ]`. */
  applyNotify(params: unknown): void {
    const patch = Array.isArray(params) ? (params[0] as PrinterObjects) : (params as PrinterObjects)
    if (!patch || typeof patch !== 'object') return

    const fast: PrinterObjects = {}
    let hasSlow = false
    for (const key of Object.keys(patch)) {
      if (FAST_PATH.has(key)) {
        fast[key] = patch[key]!
      } else {
        this.pendingPatch[key] = deepMerge(this.pendingPatch[key] ?? {}, patch[key]!)
        hasSlow = true
      }
    }
    if (Object.keys(fast).length > 0) {
      this.objects.update((o) => deepMerge(o, fast)) // immediate
    }
    if (hasSlow && this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => this.flush(), this.coalesceMs)
    }
  }

  /** Force-apply any pending coalesced patch now (e.g. on tab focus). */
  flush(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    const patch = this.pendingPatch
    this.pendingPatch = {}
    if (Object.keys(patch).length > 0) {
      this.objects.update((o) => deepMerge(o, patch))
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Recursive merge of plain objects; arrays + primitives are replaced. Returns a new object. */
export function deepMerge<T extends Record<string, unknown>>(target: T, patch: unknown): T {
  if (!isPlainObject(patch)) return target
  const out: Record<string, unknown> = { ...target }
  for (const key of Object.keys(patch)) {
    const next = patch[key]
    const prev = out[key]
    out[key] = isPlainObject(next) && isPlainObject(prev) ? deepMerge(prev, next) : next
  }
  return out as T
}
