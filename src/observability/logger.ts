// Pluggable logger + a bounded ring buffer of recent events — the substrate the
// diagnostics bundle (§11) and opt-in crash reporting collect from. Replaces the
// silent `catch {}` swallows scattered across core.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: number
  level: LogLevel
  msg: string
  data?: unknown
}

export class Logger {
  private ring: LogEntry[] = []
  constructor(
    private readonly max = 200,
    private readonly sink?: (e: LogEntry) => void,
  ) {}

  log(level: LogLevel, msg: string, data?: unknown): void {
    const e: LogEntry = data === undefined ? { ts: Date.now(), level, msg } : { ts: Date.now(), level, msg, data }
    this.ring.push(e)
    if (this.ring.length > this.max) this.ring.shift()
    this.sink?.(e)
  }

  debug(msg: string, data?: unknown): void {
    this.log('debug', msg, data)
  }
  info(msg: string, data?: unknown): void {
    this.log('info', msg, data)
  }
  warn(msg: string, data?: unknown): void {
    this.log('warn', msg, data)
  }
  error(msg: string, data?: unknown): void {
    this.log('error', msg, data)
  }

  /** Snapshot of recent events (for the diagnostics bundle). */
  recent(): LogEntry[] {
    return [...this.ring]
  }

  clear(): void {
    this.ring = []
  }
}

/** A no-op logger for when none is supplied. */
export const NULL_LOGGER = new Logger(0)
