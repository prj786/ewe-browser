import { describe, expect, it } from 'vitest'
import { isSidebarSection } from '@ewe/shared'
import { panelBounds, panelId, PANEL_INSET } from '../../src/main/panels'
import { focusScript, parseItems, parseStatus } from '../../src/main/passwords'
import { STARTUP_NAME, parseEntries, startupExec, withEntry } from '../../src/main/startup'
import { sanitizePanels } from '../../src/main/storage/settings-store'

describe('passwords broker', () => {
  it('reads ewe-pass status and keeps errors readable', () => {
    expect(
      parseStatus({ ok: true, provider: '1password', label: '1Password', ready: true }),
    ).toEqual({
      ok: true,
      provider: '1Password',
      ready: true,
      error: null,
      hint: null,
    })
    expect(
      parseStatus({ ok: false, error: 'op is locked', hint: 'Unlock 1Password' }),
    ).toMatchObject({
      ok: false,
      error: 'op is locked',
      hint: 'Unlock 1Password',
    })
    expect(parseStatus(null).error).toBe('ewe-pass is not installed')
  })

  it('keeps only item fields without secrets', () => {
    const items = parseItems({
      ok: true,
      items: [
        { id: 'a1', title: 'GitHub', username: 'ewe', host: 'github.com', score: 9, password: 'x' },
        { title: 'no id' },
        'junk',
      ],
    })
    expect(items).toEqual([
      { id: 'a1', title: 'GitHub', username: 'ewe', host: 'github.com', score: 9 },
    ])
    expect(parseItems({ ok: true })).toEqual([])
  })

  it('builds a focus script for the requested field', () => {
    expect(focusScript('password')).toContain('const what = "password"')
    expect(focusScript('login')).not.toContain('%WHAT%')
  })
})

describe('web panels', () => {
  it('derives stable unique ids from the host', () => {
    expect(panelId('https://www.web.whatsapp.com/', new Set())).toBe('web-whatsapp-com')
    expect(panelId('https://chat.example.org/x', new Set(['chat-example-org']))).toBe(
      'chat-example-org-2',
    )
    expect(panelId('nonsense', new Set())).toBe('web')
  })

  it('places the panel under the sidebar header, clear of the resize grip', () => {
    expect(panelBounds({ x: 900, y: 0, width: 360, height: 800 })).toEqual({
      x: 900 + PANEL_INSET,
      y: 44,
      width: 360 - PANEL_INSET,
      height: 756,
    })
  })

  it('sanitizes stored panels and section names', () => {
    expect(
      sanitizePanels([
        { id: 'ok', url: 'https://a.example/', title: 'A' },
        { id: 'ok', url: 'https://b.example/', title: 'dup' },
        { id: 'Bad Id', url: 'https://c.example/' },
        { id: 'js', url: 'javascript:alert(1)' },
        { id: 'notitle', url: 'http://d.example/' },
      ]),
    ).toEqual([
      { id: 'ok', url: 'https://a.example/', title: 'A' },
      { id: 'notitle', url: 'http://d.example/', title: 'notitle' },
    ])
    expect(isSidebarSection('panel:ok')).toBe(true)
    expect(isSidebarSection('panel:../x')).toBe(false)
    expect(isSidebarSection('history')).toBe(true)
  })
})

describe('ewe startup apps', () => {
  it('quotes the command and adds --background', () => {
    expect(startupExec(['/usr/bin/electron', '/opt/ewe browser/app'])).toBe(
      '/usr/bin/electron "/opt/ewe browser/app" --background',
    )
  })

  it('parses ewe-conf output and toggles only our entry', () => {
    const entries = parseEntries(
      '[{"enabled": true, "exec": "/usr/bin/steam", "icon": "steam", "name": "Steam"}]',
    )
    expect(entries).toHaveLength(1)
    expect(parseEntries('null')).toEqual([])
    expect(parseEntries(null)).toBeNull()
    expect(parseEntries('{oops')).toBeNull()
    const on = withEntry(entries ?? [], true, 'ewe-browser --background')
    expect(on.map((e) => e.name)).toEqual(['Steam', STARTUP_NAME])
    expect(withEntry(withEntry(on, true, 'x'), false, 'x').map((e) => e.name)).toEqual(['Steam'])
  })
})
