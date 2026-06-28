// machineUUID derivation - the stable key for roaming settings, the adaptive dashboard,
// and the remote-control substrate (F10). Moonraker has no single machine-uuid field, so
// we derive a deterministic id from a stable subset of machine.system_info.

import type { Connector } from '../moonraker/connector'

/** FNV-1a 32-bit hex - deterministic, dependency-free. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

interface SystemInfo {
  hostname?: string
  cpu_info?: { cpu_desc?: string; processor?: string; serial_number?: string }
  distribution?: { name?: string }
}

/** Derive a stable `fm-<hash>` machine id from Moonraker. Falls back to `fm-unknown`. */
export async function deriveMachineId(connector: Connector): Promise<string> {
  try {
    const res = await connector.call<{ system_info?: SystemInfo }>('machine.system_info')
    const si = res?.system_info ?? {}
    const stable = JSON.stringify({
      host: si.hostname ?? '',
      cpu: si.cpu_info?.serial_number ?? si.cpu_info?.cpu_desc ?? si.cpu_info?.processor ?? '',
      distro: si.distribution?.name ?? '',
    })
    if (stable === '{"host":"","cpu":"","distro":""}') return 'fm-unknown'
    return `fm-${fnv1a(stable)}`
  } catch {
    return 'fm-unknown'
  }
}

export { fnv1a }
