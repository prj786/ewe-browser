import { describe, expect, it } from 'vitest'
import { cssColor, parseEweTokens } from '../../src/main/ewe-theme'

describe('cssColor', () => {
  it('turns ewe AARRGGBB into rgba and leaves RRGGBB alone', () => {
    expect(cssColor('#cc0b0a08')).toBe('rgba(11, 10, 8, 0.800)')
    expect(cssColor('#eeb407')).toBe('#eeb407')
  })
})

describe('parseEweTokens', () => {
  it('reads colours, shadows and the scheme variant from a v3 file', () => {
    const theme = parseEweTokens(
      JSON.stringify({
        version: 3,
        color: { 'surface-base': '#0b0a08', accent: '#eeb407', scrim: '#a3020202' },
        shadow: { 'shadow-sm': { x: 0, y: 1, blur: 2, color: '#66020202' }, 'shadow-none': null },
        scheme: { name: 'Ewe Dark', variant: 'dark' },
      }),
    )
    expect(theme).toMatchObject({ source: 'ewe', variant: 'dark', name: 'Ewe Dark' })
    expect(theme?.vars).toEqual({
      '--surface-base': '#0b0a08',
      '--accent': '#eeb407',
      '--scrim': 'rgba(2, 2, 2, 0.639)',
      '--shadow-sm': '0px 1px 2px rgba(2, 2, 2, 0.400)',
    })
  })

  it('maps shape, size, type and motion into base vars', () => {
    const theme = parseEweTokens(
      JSON.stringify({
        version: 3,
        color: {},
        shape: { primary: 12, 'border-width-1': 1, bad_key: 3 },
        size: { 'font-size-md': 13, 'space-s': 8 },
        type: {
          css: { sans: '"Inter", system-ui, sans-serif', mono: 'x;}body{color:red' },
          weight: { 'font-weight-medium': 500 },
        },
        motion: {
          durFast: 150,
          durBase: 200,
          durSlow: 250,
          speed: 2,
          easing: { base: 'OutCubic', slow: 'InOutCubic' },
        },
        accessibility: { text_scale: 200 },
      }),
    )
    expect(theme?.base).toEqual({
      '--primary': '12px',
      '--border-width-1': '1px',
      '--font-size-md': '26px',
      '--space-s': '8px',
      '--font-sans': '"Inter", system-ui, sans-serif',
      '--font-weight-medium': '500',
      '--dur-fast': '75ms',
      '--dur-base': '100ms',
      '--dur-slow': '125ms',
      '--ease-out': 'cubic-bezier(0.33, 1, 0.68, 1)',
      '--ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
    })
  })

  it('collapses durations when ewe asks for reduced motion', () => {
    const theme = parseEweTokens(
      JSON.stringify({
        version: 3,
        color: {},
        motion: { durFast: 150, reduceMotion: true },
      }),
    )
    expect(theme?.base['--dur-fast']).toBe('1ms')
  })

  it('reads the real ewe file shape', () => {
    const theme = parseEweTokens(
      JSON.stringify({
        version: 3,
        input: { variant: 'light' },
        color: { accent: '#62a8f5' },
        scheme: {},
      }),
    )
    expect(theme?.variant).toBe('light')
    expect(theme?.base).toEqual({})
  })

  it('rejects other versions and garbage', () => {
    expect(parseEweTokens('{"version":2,"color":{}}')).toBeNull()
    expect(parseEweTokens('nope')).toBeNull()
  })
})
