import { describe, expect, it } from 'vitest'
import { isPageCommandAllowed, isShellCommand } from './ipc-contract'

describe('isShellCommand', () => {
  it('accepts well-formed commands', () => {
    expect(isShellCommand({ type: 'tab.create' })).toBe(true)
    expect(isShellCommand({ type: 'tab.create', url: 'https://a.b', activate: false })).toBe(true)
    expect(isShellCommand({ type: 'tab.close', id: 'x' })).toBe(true)
    expect(isShellCommand({ type: 'layout.report', page: null })).toBe(true)
    expect(
      isShellCommand({ type: 'layout.report', page: { x: 0, y: 44, width: 10, height: 10 } }),
    ).toBe(true)
    expect(isShellCommand({ type: 'overlay.request', part: 'rail' })).toBe(true)
    expect(isShellCommand({ type: 'overlay.request', part: 'palette', newTab: true })).toBe(true)
    expect(isShellCommand({ type: 'tab.navigate', input: 'x', newTab: true })).toBe(true)
    expect(isShellCommand({ type: 'overlay.pin', pinned: true })).toBe(true)
    expect(isShellCommand({ type: 'workspace.create', name: 'Work', color: 'sky' })).toBe(true)
    expect(isShellCommand({ type: 'workspace.update', id: 'w', color: 'mint' })).toBe(true)
    expect(isShellCommand({ type: 'overlay.request', part: 'bottom' })).toBe(false)
    expect(isShellCommand({ type: 'open.internal', page: 'home' })).toBe(true)
    expect(isShellCommand({ type: 'shortcuts.recording', on: true })).toBe(true)
    expect(isShellCommand({ type: 'shortcuts.recording', on: 'yes' })).toBe(false)
    expect(isShellCommand({ type: 'shortcuts.recording' })).toBe(false)
  })

  it('accepts the tab menu commands', () => {
    expect(isShellCommand({ type: 'tab.duplicate', id: 't' })).toBe(true)
    expect(isShellCommand({ type: 'tab.moveToWorkspace', id: 't' })).toBe(true)
    expect(isShellCommand({ type: 'tab.moveToWorkspace', id: 't', workspaceId: 'w' })).toBe(true)
    expect(isShellCommand({ type: 'tab.closeOthers', id: 't' })).toBe(true)
    expect(isShellCommand({ type: 'tab.closeRight', id: 't' })).toBe(true)
    expect(isShellCommand({ type: 'tab.copyUrl', id: 't' })).toBe(true)
    expect(isShellCommand({ type: 'nav.reload' })).toBe(true)
    expect(isShellCommand({ type: 'nav.reload', id: 't' })).toBe(true)
    expect(isShellCommand({ type: 'overlay.request', part: 'menu' })).toBe(true)
    expect(
      isShellCommand({ type: 'menu.open', menu: { kind: 'tab', id: 't' }, x: 10, y: 20.5 }),
    ).toBe(true)
  })

  it('accepts and checks tab.pin', () => {
    expect(isShellCommand({ type: 'tab.pin', id: 't', pinned: true })).toBe(true)
    expect(isShellCommand({ type: 'tab.pin', id: 't', pinned: false })).toBe(true)
    expect(isShellCommand({ type: 'tab.pin', id: 't' })).toBe(false)
    expect(isShellCommand({ type: 'tab.pin', pinned: true })).toBe(false)
    expect(isShellCommand({ type: 'tab.pin', id: 't', pinned: 'yes' })).toBe(false)
  })

  it('accepts the workspace menu commands', () => {
    expect(
      isShellCommand({ type: 'menu.open', menu: { kind: 'workspace', id: 'w' }, x: 4, y: 9 }),
    ).toBe(true)
    expect(isShellCommand({ type: 'workspace.mergeInto', from: 'a', to: 'b' })).toBe(true)
  })

  it('accepts and checks the bookmark commands', () => {
    expect(isShellCommand({ type: 'bookmark.toggle' })).toBe(true)
    expect(isShellCommand({ type: 'bookmark.toggle', tabId: 't' })).toBe(true)
    expect(isShellCommand({ type: 'bookmark.toggle', tabId: 4 })).toBe(false)
    expect(isShellCommand({ type: 'bookmark.add', url: 'https://a.b/', title: 'a' })).toBe(true)
    expect(
      isShellCommand({ type: 'bookmark.add', url: 'https://a.b/', title: 'a', folderId: 'f' }),
    ).toBe(true)
    expect(isShellCommand({ type: 'bookmark.add', url: 'https://a.b/' })).toBe(false)
    expect(isShellCommand({ type: 'bookmark.remove', id: 'b' })).toBe(true)
    expect(isShellCommand({ type: 'bookmark.remove' })).toBe(false)
    expect(isShellCommand({ type: 'bookmark.update', id: 'b' })).toBe(true)
    expect(
      isShellCommand({ type: 'bookmark.update', id: 'b', title: 't', url: 'u', folderId: 'f' }),
    ).toBe(true)
    expect(isShellCommand({ type: 'bookmark.update', id: 'b', title: 1 })).toBe(false)
    expect(isShellCommand({ type: 'bookmark.folder.create', title: 'Dev' })).toBe(true)
    expect(isShellCommand({ type: 'bookmark.folder.create', title: 'Dev', parentId: 'p' })).toBe(
      true,
    )
    expect(isShellCommand({ type: 'bookmark.folder.create' })).toBe(false)
    expect(isShellCommand({ type: 'bookmarks.importChrome' })).toBe(true)
    expect(isShellCommand({ type: 'menu.open', menu: { kind: 'bookmarks' }, x: 1, y: 2 })).toBe(
      false,
    )
    expect(isShellCommand({ type: 'overlay.request', part: 'toast' })).toBe(true)
    expect(isShellCommand({ type: 'bookmark.update', id: 'b', folderId: 'f', index: 2 })).toBe(true)
    expect(isShellCommand({ type: 'bookmark.update', id: 'b', index: -1 })).toBe(false)
    expect(isShellCommand({ type: 'bookmark.update', id: 'b', index: 1.5 })).toBe(false)
  })

  it('validates sidebar, download and history commands', () => {
    expect(isShellCommand({ type: 'sidebar.toggle' })).toBe(true)
    expect(isShellCommand({ type: 'sidebar.toggle', section: 'downloads' })).toBe(true)
    expect(isShellCommand({ type: 'sidebar.toggle', section: 'files' })).toBe(false)
    expect(isShellCommand({ type: 'sidebar.close' })).toBe(true)
    expect(isShellCommand({ type: 'sidebar.resize', width: 400 })).toBe(true)
    expect(isShellCommand({ type: 'sidebar.resize', width: 400, commit: true })).toBe(true)
    expect(isShellCommand({ type: 'sidebar.resize', width: Infinity })).toBe(false)
    expect(isShellCommand({ type: 'download', id: 'd', action: 'pause' })).toBe(true)
    expect(isShellCommand({ type: 'download', id: 'd', action: 'delete-file' })).toBe(false)
    expect(isShellCommand({ type: 'downloads.clear' })).toBe(true)
    expect(isShellCommand({ type: 'history.remove', url: 'https://a.test/' })).toBe(true)
    expect(isShellCommand({ type: 'history.remove' })).toBe(false)
  })

  it('rejects malformed commands', () => {
    expect(isShellCommand({ type: 'workspace.mergeInto', from: 'a' })).toBe(false)
    expect(isShellCommand({ type: 'workspace.mergeInto', from: 'a', to: 2 })).toBe(false)
    expect(isShellCommand({ type: 'menu.open', menu: { kind: 'workspace' }, x: 1, y: 1 })).toBe(
      false,
    )
    expect(isShellCommand(null)).toBe(false)
    expect(isShellCommand({ type: 'tab.close' })).toBe(false)
    expect(isShellCommand({ type: 'tab.move', id: 'x', index: '1' })).toBe(false)
    expect(isShellCommand({ type: 'layout.report', page: { x: 0 } })).toBe(false)
    expect(isShellCommand({ type: 'overlay.request', part: 'corner' })).toBe(false)
    expect(isShellCommand({ type: 'overlay.pin', pinned: 'yes' })).toBe(false)
    expect(isShellCommand({ type: 'workspace.create', color: 'neon' })).toBe(false)
    expect(isShellCommand({ type: 'workspace.activate' })).toBe(false)
    expect(isShellCommand({ type: 'open.internal', page: 'bookmarks' })).toBe(false)
    expect(isShellCommand({ type: 'tab.duplicate' })).toBe(false)
    expect(isShellCommand({ type: 'tab.moveToWorkspace', id: 't', workspaceId: 3 })).toBe(false)
    expect(isShellCommand({ type: 'nav.reload', id: 7 })).toBe(false)
    expect(isShellCommand({ type: 'menu.open', menu: { kind: 'tab', id: 't' }, x: 1 })).toBe(false)
    expect(
      isShellCommand({ type: 'menu.open', menu: { kind: 'tab', id: 't' }, x: NaN, y: 1 }),
    ).toBe(false)
    expect(isShellCommand({ type: 'menu.open', menu: { kind: 'window' }, x: 1, y: 1 })).toBe(false)
    expect(isShellCommand({ type: 'nope' })).toBe(false)
  })
})

describe('isPageCommandAllowed', () => {
  it('lets internal pages navigate but not reshape the window', () => {
    expect(isPageCommandAllowed({ type: 'tab.navigate', input: 'x' })).toBe(true)
    expect(isPageCommandAllowed({ type: 'window.close' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'layout.report', page: null })).toBe(false)
  })

  it('lets pages import Chrome bookmarks but not edit bookmarks', () => {
    expect(isPageCommandAllowed({ type: 'bookmarks.importChrome' })).toBe(true)
    expect(isPageCommandAllowed({ type: 'bookmark.toggle' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'bookmark.remove', id: 'b' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'bookmark.add', url: 'u', title: 't' })).toBe(false)
  })

  it('keeps sidebar, downloads and history away from pages', () => {
    expect(isPageCommandAllowed({ type: 'sidebar.toggle' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'download', id: 'd', action: 'open' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'history.remove', url: 'u' })).toBe(false)
  })

  it('keeps the tab menu commands away from pages', () => {
    expect(isPageCommandAllowed({ type: 'tab.duplicate', id: 't' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'tab.closeOthers', id: 't' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'tab.copyUrl', id: 't' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'tab.pin', id: 't', pinned: true })).toBe(false)
    expect(
      isPageCommandAllowed({ type: 'menu.open', menu: { kind: 'tab', id: 't' }, x: 0, y: 0 }),
    ).toBe(false)
  })
})

describe('find, page menu and Safe-only commands', () => {
  it('accepts the find and page menu commands', () => {
    expect(isShellCommand({ type: 'find.query', text: 'sheep' })).toBe(true)
    expect(isShellCommand({ type: 'find.step', forward: false })).toBe(true)
    expect(isShellCommand({ type: 'find.close' })).toBe(true)
    expect(isShellCommand({ type: 'page.menu.run', menuId: 'm', action: 'link.tab' })).toBe(true)
    expect(isShellCommand({ type: 'menu.open', menu: { kind: 'page', id: 'm' }, x: 1, y: 2 })).toBe(
      true,
    )
  })

  it('rejects malformed ones and the old ewe-pass commands', () => {
    expect(isShellCommand({ type: 'find.query', text: 'x'.repeat(1001) })).toBe(false)
    expect(isShellCommand({ type: 'find.step', forward: 'yes' })).toBe(false)
    expect(isShellCommand({ type: 'page.menu.run', menuId: 'm', action: 'x'.repeat(65) })).toBe(
      false,
    )
    expect(isShellCommand({ type: 'passwords.fill', id: 'a', what: 'login' })).toBe(false)
    expect(isShellCommand({ type: 'passwords.copy', id: 'a', what: 'password' })).toBe(false)
    expect(isShellCommand({ type: 'passwords.open' })).toBe(true)
  })

  it('keeps them away from pages', () => {
    expect(isPageCommandAllowed({ type: 'find.query', text: 'x' })).toBe(false)
    expect(isPageCommandAllowed({ type: 'page.menu.run', menuId: 'm', action: 'inspect' })).toBe(
      false,
    )
  })
})
