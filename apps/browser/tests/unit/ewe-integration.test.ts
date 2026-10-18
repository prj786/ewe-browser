import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSidebarSection, storeExtensionId } from '@ewe/shared'
import { badgeColor, localizedName, popupBounds } from '../../src/main/extension-helpers'
import { chromeBrands, storeHeaders } from '../../src/main/identity'
import { panelBounds, panelId, PANEL_INSET } from '../../src/main/panels'
import { STARTUP_NAME, parseEntries, startupExec, withEntry } from '../../src/main/startup'
import { sanitizePanels } from '../../src/main/storage/settings-store'

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

describe('extensions', () => {
  it('places popups under the button and keeps them in the window', () => {
    const anchor = { x: 12, y: 120, width: 32, height: 32 }
    expect(popupBounds(anchor, { width: 260, height: 300 }, { width: 1200, height: 800 })).toEqual({
      x: 12,
      y: 158,
      width: 260,
      height: 300,
    })
    expect(
      popupBounds({ ...anchor, y: 700 }, { width: 900, height: 400 }, { width: 1200, height: 800 }),
    ).toEqual({ x: 12, y: 294, width: 800, height: 400 })
    expect(popupBounds(anchor, { width: 1, height: 1 }, { width: 1200, height: 800 }).width).toBe(
      25,
    )
  })

  it('reads badge colours and store ids', () => {
    expect(badgeColor('#ff0000')).toBe('#ff0000')
    expect(badgeColor([59, 110, 74, 255])).toBe('rgba(59, 110, 74, 1)')
    expect(badgeColor(undefined)).toBeNull()
    expect(storeExtensionId('ddkjiahejlhfcafbddmgiahcphecmpfh')).toBe(
      'ddkjiahejlhfcafbddmgiahcphecmpfh',
    )
    expect(
      storeExtensionId(
        'https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh?hl=en',
      ),
    ).toBe('ddkjiahejlhfcafbddmgiahcphecmpfh')
    expect(storeExtensionId('https://example.com/ddkjiahejlhfcafbddmgiahcphecmpfh')).toBeNull()
    expect(storeExtensionId('not an id')).toBeNull()
  })

  it('resolves localized extension names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-ext-'))
    mkdirSync(join(dir, '_locales', 'en'), { recursive: true })
    writeFileSync(
      join(dir, '_locales', 'en', 'messages.json'),
      JSON.stringify({ extName: { message: 'Flock Guard' } }),
    )
    expect(await localizedName(dir, { name: '__MSG_extName__', default_locale: 'en' })).toBe(
      'Flock Guard',
    )
    expect(await localizedName(dir, { name: 'Plain' })).toBe('Plain')
  })

  it('tells the Web Store this is Chrome', () => {
    expect(chromeBrands('152')).toBe(
      '"Not?A_Brand";v="24", "Chromium";v="152", "Google Chrome";v="152"',
    )
    const headers = storeHeaders({ 'Sec-CH-UA': '"Chromium";v="152"', Accept: '*/*' }, '152')
    expect(headers.Accept).toBe('*/*')
    expect(headers['Sec-CH-UA']).toBeUndefined()
    expect(headers['sec-ch-ua']).toContain('"Google Chrome"')
    expect(headers['sec-ch-ua-platform']).toBe('"Linux"')
  })
})
