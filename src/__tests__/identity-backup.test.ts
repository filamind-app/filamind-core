import { describe, it, expect } from 'vitest'
import { deriveMachineId, fnv1a } from '../identity/machine'
import { RestorePoints, memoryRestoreStore } from '../backup/restore-points'
import type { Connector } from '../moonraker/connector'

function connWith(systemInfo: unknown): Connector {
  return {
    state: 'ready',
    connect: async () => {},
    close: () => {},
    call: async <T>(): Promise<T> => ({ system_info: systemInfo }) as T,
    subscribe: async () => {},
    upload: async () => {},
    download: async () => new Blob(),
    setCallbacks: () => {},
  }
}

describe('machine identity', () => {
  it('fnv1a is deterministic 8-hex and discriminating', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('abc')).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'))
  })

  it('derives a stable fm-<hash> from a stable system_info subset', async () => {
    const si = { hostname: 'sv08', cpu_info: { serial_number: 'XYZ' }, distribution: { name: 'Debian' } }
    const a = await deriveMachineId(connWith(si))
    const b = await deriveMachineId(connWith(si))
    expect(a).toMatch(/^fm-[0-9a-f]{8}$/)
    expect(a).toBe(b)
  })

  it('falls back to fm-unknown for empty info or a failing call', async () => {
    expect(await deriveMachineId(connWith({}))).toBe('fm-unknown')
    const throwing: Connector = {
      ...connWith({}),
      call: async () => {
        throw new Error('no machine.system_info')
      },
    }
    expect(await deriveMachineId(throwing)).toBe('fm-unknown')
  })
})

describe('RestorePoints', () => {
  it('snapshots, lists, and gets by id', async () => {
    const rp = new RestorePoints(memoryRestoreStore(), 'fm-1')
    const p = await rp.snapshot('printer.cfg', 'pre-save', { a: 1 })
    expect((await rp.list()).length).toBe(1)
    expect((await rp.get(p.id))?.data).toEqual({ a: 1 })
    expect(p.reversible).toBe(true)
  })

  it('prunes per scope to the retention bound, keeping the newest', async () => {
    const rp = new RestorePoints(memoryRestoreStore(), 'fm-1', 2)
    const a = await rp.snapshot('cfg', 't', 0)
    const b = await rp.snapshot('cfg', 't', 1)
    const c = await rp.snapshot('cfg', 't', 2)
    await rp.snapshot('other', 't', 9) // a different scope is untouched by cfg pruning
    const all = await rp.list()
    const ids = all.map((x) => x.id)
    expect(ids).not.toContain(a.id) // oldest cfg point pruned
    expect(ids).toContain(b.id)
    expect(ids).toContain(c.id)
    expect(all.filter((x) => x.scope === 'cfg').length).toBe(2)
    expect(all.filter((x) => x.scope === 'other').length).toBe(1)
  })
})
