// Parses Klipper's interactive `// action:prompt_*` protocol (emitted on
// notify_gcode_response) into structured modal dialogs - the native-grade
// resilience UX (F13). Button clicks run their gcode through the write-arbiter.

export type ButtonStyle = 'primary' | 'secondary' | 'warning'

export interface PromptButton {
  label: string
  gcode?: string
  style?: ButtonStyle
}

export interface PromptDialog {
  title?: string
  text: string[]
  buttons: PromptButton[]
  footer: PromptButton[]
}

export type PromptEvent =
  | { type: 'show'; dialog: PromptDialog }
  | { type: 'end' }
  | null

function parseButton(rest: string): PromptButton {
  // "<label>|<gcode>|<style>"
  const [label = '', gcode = '', style = ''] = rest.split('|')
  const out: PromptButton = { label: label.trim() }
  if (gcode.trim()) out.gcode = gcode.trim()
  if (style.trim() === 'primary' || style.trim() === 'secondary' || style.trim() === 'warning') {
    out.style = style.trim() as ButtonStyle
  }
  return out
}

export class PromptParser {
  private current: PromptDialog | null = null

  /** Feed one notify_gcode_response line. Returns a PromptEvent at show/end, else null. */
  feed(line: string): PromptEvent {
    const m = /^\s*\/\/\s*action:\s*prompt_(\w+)\s?(.*)$/.exec(line)
    if (!m) return null
    const verb = m[1]
    const rest = (m[2] ?? '').trim()
    switch (verb) {
      case 'begin':
        this.current = { title: rest || undefined, text: [], buttons: [], footer: [] }
        return null
      case 'text':
        this.current?.text.push(rest)
        return null
      case 'button':
        this.current?.buttons.push(parseButton(rest))
        return null
      case 'footer_button':
        this.current?.footer.push(parseButton(rest))
        return null
      case 'show': {
        const dialog = this.current ?? { text: [], buttons: [], footer: [] }
        return { type: 'show', dialog }
      }
      case 'end':
        this.current = null
        return { type: 'end' }
      default:
        // button_group_start/end and unknown verbs: ignored (no layout impact here)
        return null
    }
  }
}
