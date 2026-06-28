// Restore-point primitive (§11/§12/§14/§15) - the "back up first, reversible, one-click
// rollback" substrate that gates config saves, plugin installs, firmware flash, Known-Good
// Pack apply, and migration. Snapshots are machineUUID-keyed, retention-bounded.

export interface RestorePoint {
  id: string
  /** what was snapshotted, e.g. 'printer.cfg' | 'settings' | 'config-templates' */
  scope: string
  /** why, e.g. 'pre-config-save' | 'pre-plugin-install' | 'pre-migrate' */
  trigger: string
  ts: number
  /** monotonic tiebreak so prune is deterministic even when two points share a ts (ms clock) */
  seq: number
  reversible: boolean
  data: unknown
}

export interface RestoreStore {
  list(machineId: string): Promise<RestorePoint[]>
  save(machineId: string, p: RestorePoint): Promise<void>
  remove(machineId: string, id: string): Promise<void>
}

export function memoryRestoreStore(): RestoreStore {
  const byMachine = new Map<string, RestorePoint[]>()
  return {
    list: async (m) => [...(byMachine.get(m) ?? [])],
    save: async (m, p) => {
      const arr = byMachine.get(m) ?? []
      arr.push(p)
      byMachine.set(m, arr)
    },
    remove: async (m, id) => {
      byMachine.set(m, (byMachine.get(m) ?? []).filter((p) => p.id !== id))
    },
  }
}

export class RestorePoints {
  private seq = 0

  constructor(
    private readonly store: RestoreStore,
    private readonly machineId: string,
    private readonly retention = 20,
  ) {}

  async snapshot(scope: string, trigger: string, data: unknown, reversible = true): Promise<RestorePoint> {
    const seq = this.seq++
    const ts = Date.now()
    const point: RestorePoint = {
      id: `rp-${ts}-${seq}`,
      scope,
      trigger,
      ts,
      seq,
      reversible,
      data,
    }
    await this.store.save(this.machineId, point)
    await this.prune(scope)
    return point
  }

  list(): Promise<RestorePoint[]> {
    return this.store.list(this.machineId)
  }

  async get(id: string): Promise<RestorePoint | undefined> {
    return (await this.list()).find((p) => p.id === id)
  }

  /** Keep only the newest `retention` points per scope. */
  private async prune(scope: string): Promise<void> {
    const all = await this.list()
    const inScope = all.filter((p) => p.scope === scope).sort((a, b) => b.ts - a.ts || b.seq - a.seq)
    for (const stale of inScope.slice(this.retention)) {
      await this.store.remove(this.machineId, stale.id)
    }
  }
}
