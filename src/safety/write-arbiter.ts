// Fail-closed write-arbiter (§12 spine) — the single chokepoint every FilaMind-originated
// mutation (gcode, config write, setup action) funnels through. It enforces safe-mode and
// a caller-supplied guard (e.g. "Klippy ready + connection live"), and logs every write.
// This is the enforcement arm of provenance: if state isn't trustworthy, writes are refused.

import { Observable } from '../state/observable'
import type { Logger } from '../observability/logger'

export interface GuardResult {
  ok: boolean
  reason?: string
}

export type WriteGuard = (action: string) => GuardResult

export class WriteRefused extends Error {
  constructor(
    public readonly action: string,
    reason: string,
  ) {
    super(`write refused (${action}): ${reason}`)
    this.name = 'WriteRefused'
  }
}

export class WriteArbiter {
  readonly safeMode = new Observable<boolean>(false)

  constructor(
    /** caller supplies the live-trust check (Klippy ready + connection ready, not printing-locked, …) */
    private readonly guard: WriteGuard = () => ({ ok: true }),
    private readonly logger?: Logger,
  ) {}

  setSafeMode(on: boolean, reason?: string): void {
    this.safeMode.set(on)
    this.logger?.warn(`safe-mode ${on ? 'ON' : 'off'}`, reason)
  }

  /** Run a mutation through the gate. Throws WriteRefused if blocked. */
  async run<T>(action: string, fn: () => Promise<T>): Promise<T> {
    if (this.safeMode.value) throw new WriteRefused(action, 'safe-mode active')
    const g = this.guard(action)
    if (!g.ok) throw new WriteRefused(action, g.reason ?? 'guard rejected')
    this.logger?.info(`write: ${action}`)
    return fn()
  }
}
