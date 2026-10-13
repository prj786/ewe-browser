import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: {}, protocol: { registerSchemesAsPrivileged: () => undefined } }))

const { devTargetPath, prodRelativePath } = await import('../../src/main/protocol')

describe('devTargetPath', () => {
  it('maps the page root and page-relative files into the pages folder', () => {
    expect(devTargetPath('newtab', '/')).toBe('/pages/newtab/index.html')
    expect(devTargetPath('newtab', '/main.tsx')).toBe('/pages/newtab/main.tsx')
  })

  it('maps the home page', () => {
    expect(devTargetPath('home', '/')).toBe('/pages/home/index.html')
  })

  it('passes vite and workspace paths through', () => {
    expect(devTargetPath('newtab', '/@vite/client')).toBe('/@vite/client')
    expect(devTargetPath('newtab', '/ui/styles/base.css')).toBe('/ui/styles/base.css')
    expect(devTargetPath('newtab', '/@fs/home/x/y.ts')).toBe('/@fs/home/x/y.ts')
    expect(devTargetPath('newtab', '/@solid-refresh')).toBe('/@solid-refresh')
  })
})

describe('prodRelativePath', () => {
  it('serves the page index and hashed assets only', () => {
    expect(prodRelativePath('settings', '/')).toBe('pages/settings/index.html')
    expect(prodRelativePath('home', '/')).toBe('pages/home/index.html')
    expect(prodRelativePath('settings', '/assets/x.js')).toBe('assets/x.js')
    expect(prodRelativePath('settings', '/pages/settings/main.tsx')).toBeNull()
    expect(prodRelativePath('settings', '/assets/../main/index.js')).toBeNull()
    expect(prodRelativePath('settings', '/../package.json')).toBeNull()
  })
})
