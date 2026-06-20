import { describe, it, expect } from 'vitest'
import { WriteArbiter, WriteRefused } from '../safety/write-arbiter'

describe('WriteArbiter', () => {
  it('runs the mutation when not in safe-mode and the guard passes', async () => {
    const a = new WriteArbiter()
    expect(await a.run('gcode', async () => 7)).toBe(7)
  })

  it('refuses every write while safe-mode is active', async () => {
    const a = new WriteArbiter()
    a.setSafeMode(true, 'firmware mismatch')
    await expect(a.run('flash', async () => 1)).rejects.toBeInstanceOf(WriteRefused)
    expect(a.safeMode.value).toBe(true)
  })

  it('refuses when the guard rejects, surfacing the reason', async () => {
    const a = new WriteArbiter(() => ({ ok: false, reason: 'klippy not ready' }))
    await expect(a.run('save_config', async () => 1)).rejects.toThrow(/klippy not ready/)
  })

  it('lifts the gate again once safe-mode is cleared', async () => {
    const a = new WriteArbiter()
    a.setSafeMode(true)
    a.setSafeMode(false)
    expect(await a.run('home', async () => 'ok')).toBe('ok')
  })
})
