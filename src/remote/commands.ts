// Cross-surface remote-control command protocol. One FilaMind surface (e.g. FilaMind 3d) can
// steer another (e.g. the on-printer FilaMind screen) by broadcasting a command over Moonraker's
// agent-event bus (connection.send_event -> notify_agent_event). Commands are UI-ONLY - they
// navigate/annotate another surface, never touch the printer - so they are NOT §12 writes.
//
// This module is transport-agnostic: it defines the event name, the command union, and STRICT
// validators. Untrusted input (the bus is broadcast to every client) is parsed defensively - an
// unrecognised shape yields null and is ignored, exactly like settings migrate().

/** The single agent-event name FilaMind uses; everything else on the bus is ignored. */
export const FILAMIND_COMMAND_EVENT = 'filamind:command'

/** The views a screen-style surface can be told to show (matches the touch app's tabs). */
export const REMOTE_VIEWS = ['status', 'control', 'settings'] as const
export type RemoteView = (typeof REMOTE_VIEWS)[number]

export const REMOTE_MESSAGE_LEVELS = ['info', 'warn'] as const
export type RemoteMessageLevel = (typeof REMOTE_MESSAGE_LEVELS)[number]

/** A UI-only instruction sent from one surface to another. */
export type RemoteCommand =
  | { kind: 'navigate'; view: RemoteView }
  | { kind: 'message'; level: RemoteMessageLevel; text: string }
  | { kind: 'locate' }

/** The shape Moonraker delivers in notify_agent_event params[0]. */
export interface AgentEvent {
  agent: string
  event: string
  data?: unknown
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// C0 controls (0000-001F), DEL + C1 (007F-009F), zero-width (200B-200F), bidi embedding/override
// (202A-202E), bidi isolates (2066-2069), and BOM/ZWNBSP (FEFF). The bus is an open broadcast, so
// strip these from untrusted message text before it reaches the DOM. Built from \u escapes (ASCII
// source only) so the pattern is unambiguous.
const CONTROL_BIDI = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g',
)

/** Clean untrusted text: drop control/bidi chars, then clamp by CODE POINT (never split a surrogate
 *  pair). Returns null when nothing printable remains. */
function sanitizeText(raw: string): string | null {
  const cleaned = Array.from(raw.replace(CONTROL_BIDI, ' '))
    .slice(0, 280)
    .join('')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

/** Validate an arbitrary blob (from the broadcast bus) into a RemoteCommand, or null if it isn't one. */
export function parseCommand(raw: unknown): RemoteCommand | null {
  if (!isObj(raw)) return null
  switch (raw.kind) {
    case 'navigate':
      return typeof raw.view === 'string' && (REMOTE_VIEWS as readonly string[]).includes(raw.view)
        ? { kind: 'navigate', view: raw.view as RemoteView }
        : null
    case 'message': {
      if (typeof raw.text !== 'string') return null
      if (
        typeof raw.level !== 'string' ||
        !(REMOTE_MESSAGE_LEVELS as readonly string[]).includes(raw.level)
      )
        return null
      const text = sanitizeText(raw.text)
      return text ? { kind: 'message', level: raw.level as RemoteMessageLevel, text } : null
    }
    case 'locate':
      return { kind: 'locate' }
    default:
      return null
  }
}

/** Parse Moonraker's notify_agent_event params (an array holding one event object) into an AgentEvent. */
export function parseAgentEvent(params: unknown): AgentEvent | null {
  const obj = Array.isArray(params) ? params[0] : params
  if (!isObj(obj)) return null
  if (typeof obj.agent !== 'string' || typeof obj.event !== 'string') return null
  return { agent: obj.agent, event: obj.event, data: obj.data }
}

/** Optional sender allow-list: an array of accepted agent names, or a predicate over the name. */
export type AgentAllow = readonly string[] | ((agent: string) => boolean)

/** If an agent event is a (validated) FilaMind command from an allowed sender, hand it to the surface's
 *  dispatcher. The allow-list is best-effort defence-in-depth: client_name is self-asserted, which is
 *  WHY these commands must stay strictly UI-only and never reach the printer-write path. */
export function handleAgentCommand(
  ev: AgentEvent,
  dispatch: (cmd: RemoteCommand) => void,
  opts?: { allowFrom?: AgentAllow },
): void {
  if (ev.event !== FILAMIND_COMMAND_EVENT) return
  const allow = opts?.allowFrom
  if (allow) {
    const ok = typeof allow === 'function' ? allow(ev.agent) : allow.includes(ev.agent)
    if (!ok) return
  }
  const cmd = parseCommand(ev.data)
  if (cmd) dispatch(cmd)
}
