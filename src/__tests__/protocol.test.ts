import { describe, it, expect } from 'vitest'
import { PromptParser } from '../printer/prompt-parser'
import { deriveKlippyState, isKlippyLive } from '../printer/klippy'
import {
  NARROW_STATUS,
  FULL_CONTROL,
  tier,
  SUBSCRIPTION_CONTRACT_VERSION,
} from '../moonraker/subscriptions'

describe('PromptParser', () => {
  it('ignores non-action lines', () => {
    expect(new PromptParser().feed('ok')).toBeNull()
    expect(new PromptParser().feed('// just a comment')).toBeNull()
  })

  it('assembles a dialog across begin/text/button/footer_button/show', () => {
    const p = new PromptParser()
    expect(p.feed('// action:prompt_begin Title')).toBeNull()
    p.feed('// action:prompt_text Line one')
    p.feed('// action:prompt_button Yes|DO_IT|primary')
    p.feed('// action:prompt_footer_button Cancel|ABORT')
    expect(p.feed('// action:prompt_show')).toEqual({
      type: 'show',
      dialog: {
        title: 'Title',
        text: ['Line one'],
        buttons: [{ label: 'Yes', gcode: 'DO_IT', style: 'primary' }],
        footer: [{ label: 'Cancel', gcode: 'ABORT' }],
      },
    })
    expect(p.feed('// action:prompt_end')).toEqual({ type: 'end' })
  })

  it('is resilient to show without a preceding begin', () => {
    expect(new PromptParser().feed('// action:prompt_show')).toEqual({
      type: 'show',
      dialog: { text: [], buttons: [], footer: [] },
    })
  })
})

describe('klippy lifecycle', () => {
  it('maps known states and defaults the unknown to disconnected', () => {
    expect(deriveKlippyState('ready')).toBe('ready')
    expect(deriveKlippyState('shutdown')).toBe('shutdown')
    expect(deriveKlippyState('???')).toBe('disconnected')
    expect(deriveKlippyState(undefined)).toBe('disconnected')
  })
  it('treats only ready as live', () => {
    expect(isKlippyLive('ready')).toBe(true)
    expect(isKlippyLive('startup')).toBe(false)
    expect(isKlippyLive('disconnected')).toBe(false)
  })
})

describe('subscription contract', () => {
  it('is versioned and exposes the two baseline tiers', () => {
    expect(SUBSCRIPTION_CONTRACT_VERSION).toBe(1)
    expect(tier('narrow')).toBe(NARROW_STATUS)
    expect(tier('full')).toBe(FULL_CONTROL)
    expect(FULL_CONTROL.gcode_move).toBeNull() // null = all fields
    expect(NARROW_STATUS.print_stats).toContain('state')
  })
})
