import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eweSyncArgs } from '../../src/main/ewe-sync'
import {
  DirWatch,
  EweLink,
  effectiveSync,
  eweSignedIn,
  managedMode,
  parseBrowserFlag,
  type EweSyncState,
} from '../../src/main/sync/ewe-link'
import { SyncService } from '../../src/main/sync/service'
import { parseSyncSnapshot } from '../../src/main/sync/snapshot'
import { BookmarksStore } from '../../src/main/storage/bookmarks-store'
import { HistoryStore } from '../../src/main/storage/history-store'
import { SettingsStore } from '../../src/main/storage/settings-store'
import { davMock } from '../support/dav-mock'

vi.mock('electron', () => ({
  app: { getName: () => 'ewe-browser', userAgentFallback: 'Mozilla/5.0 Chrome/152.0.0.0' },
  ipcMain: { handle: () => undefined },
  webContents: { getAllWebContents: () => [] },
}))

const dirs: string[] = []
function temp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ewe-link-${name}-`))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (check()) resolve()
      else if (Date.now() - start > ms) reject(new Error('timed out'))
      else setTimeout(tick, 20)
    }
    tick()
  })
}

describe('the browser follows the ewe account', () => {
  it('is managed only for the real profile with ewe-conf present', () => {
    expect(managedMode({}, true)).toBe(true)
    expect(managedMode({}, false)).toBe(false)
    expect(managedMode({ EWE_USER_DATA: '/tmp/p' }, true)).toBe(false)
    expect(managedMode({ EWE_SYNC_URL: 'http://127.0.0.1:1/' }, true)).toBe(false)
    expect(managedMode({ EWE_SYNC_MANAGED: '1', EWE_USER_DATA: '/tmp/p' }, false)).toBe(true)
    expect(managedMode({ EWE_SYNC_MANAGED: '0' }, true)).toBe(false)
  })

  it('syncs when signed in unless sync.browser is false; outside ewe the toggle decides', () => {
    const on = (signedIn: boolean, browser: boolean | null): EweSyncState => ({
      managed: true,
      signedIn,
      browser,
    })
    expect(effectiveSync(on(true, null), false)).toBe(true)
    expect(effectiveSync(on(true, true), false)).toBe(true)
    expect(effectiveSync(on(true, false), true)).toBe(false)
    expect(effectiveSync(on(false, true), true)).toBe(false)
    const off: EweSyncState = { managed: false, signedIn: true, browser: false }
    expect(effectiveSync(off, true)).toBe(true)
    expect(effectiveSync(off, false)).toBe(false)
  })

  it('reads sync.browser and the sign-in', () => {
    expect(parseBrowserFlag('true\n')).toBe(true)
    expect(parseBrowserFlag('false')).toBe(false)
    expect(parseBrowserFlag(null)).toBeNull()
    expect(parseBrowserFlag('"yes"')).toBeNull()
    const dir = temp('cloud')
    const path = join(dir, 'cloud.json')
    expect(eweSignedIn(path)).toBe(false)
    writeFileSync(path, JSON.stringify({ user: 'me' }))
    expect(eweSignedIn(path)).toBe(false)
    writeFileSync(path, JSON.stringify({ server: 'https://c.example', login_name: 'me' }))
    expect(eweSignedIn(path)).toBe(true)
  })

  it('emits a change only when the decision inputs move', async () => {
    let signedIn = false
    let flag: boolean | null = null
    const link = new EweLink({
      managed: true,
      configDir: temp('cfg'),
      stateDir: temp('state'),
      signedIn: () => signedIn,
      browserFlag: () => Promise.resolve(flag),
    })
    const seen: EweSyncState[] = []
    link.on('change', (s) => seen.push(s))
    await link.refresh()
    expect(seen).toEqual([])
    signedIn = true
    await link.refresh()
    flag = false
    await link.refresh()
    await link.refresh()
    expect(seen).toEqual([
      { managed: true, signedIn: true, browser: null },
      { managed: true, signedIn: true, browser: false },
    ])
    const unmanaged = new EweLink({ managed: false, signedIn: () => true })
    expect(unmanaged.current()).toEqual({ managed: false, signedIn: false, browser: null })
  })

  it('hears the nudge and the snapshot in a directory that appears later', async () => {
    const root = temp('watch')
    const dir = join(root, 'ewe')
    mkdirSync(dir)
    const heard: string[] = []
    const watch = new DirWatch(dir, ['sync-now'], (names) => heard.push(...names), 30)
    writeFileSync(join(dir, 'other'), 'x')
    writeFileSync(join(dir, 'sync-now'), String(Date.now()))
    await waitFor(() => heard.includes('sync-now'))
    expect(heard).not.toContain('other')
    watch.close()
  })
})

describe('the folder snapshot', () => {
  it('validates and normalises what ewe-sync writes', () => {
    const snapshot = parseSyncSnapshot(
      JSON.stringify({
        version: 1,
        signed_in: true,
        state: 'attention',
        folders: [
          {
            key: 'Documents|two-way',
            name: 'Documents',
            local: '/h/Documents/',
            remote: 'Documents',
            mode: 'two-way',
            engine: 'ewe',
            state: 'conflict',
            last_sync: 1793470000,
            conflicts: 2,
            error: '',
          },
          { local: '/h/Documents', state: 'synced' },
          { local: 'relative', state: 'synced' },
          { local: '/', state: 'synced' },
          { local: '/h/Nextcloud', engine: 'nextcloud-app', state: 'weird', conflicts: -1 },
          'junk',
        ],
        account_folder: { path: '/h/Nextcloud', state: 'synced' },
      }),
    )
    expect(snapshot?.signedIn).toBe(true)
    expect(snapshot?.folders).toEqual([
      {
        key: 'Documents|two-way',
        name: 'Documents',
        local: '/h/Documents',
        remote: 'Documents',
        state: 'conflict',
        conflicts: 2,
        lastSync: 1793470000000,
        engine: 'ewe',
        error: '',
      },
      {
        key: '',
        name: 'Nextcloud',
        local: '/h/Nextcloud',
        remote: '',
        state: 'pending',
        conflicts: 0,
        lastSync: null,
        engine: 'nextcloud-app',
        error: '',
      },
    ])
    expect(snapshot?.accountFolder).toEqual({ path: '/h/Nextcloud', state: 'synced' })
    expect(parseSyncSnapshot(null)).toBeNull()
    expect(parseSyncSnapshot('{')).toBeNull()
    expect(parseSyncSnapshot('{"version":2,"folders":[]}')).toBeNull()
    expect(parseSyncSnapshot('{"version":1}')).toBeNull()
  })
})

describe('starting ewe-sync', () => {
  it('builds argv only for known panes and existing absolute folders', () => {
    const dirs = new Set(['/h/Work'])
    const isDir = (p: string) => dirs.has(p)
    expect(eweSyncArgs({ op: 'pane', pane: 'folders' }, isDir)).toEqual(['--pane', 'folders'])
    expect(eweSyncArgs({ op: 'add-folder', path: '/h/Work' }, isDir)).toEqual([
      '--add-folder',
      '/h/Work',
    ])
    expect(eweSyncArgs({ op: 'add-folder', path: '/h/Gone' }, isDir)).toBeNull()
    expect(eweSyncArgs({ op: 'add-folder', path: '/h/x/../Work' }, () => true)).toBeNull()
    expect(eweSyncArgs({ op: 'add-folder', path: '/' }, () => true)).toBeNull()
    expect(eweSyncArgs({ op: 'available' }, isDir)).toBeNull()
  })
})

describe('SyncService under ewe', () => {
  it('follows the account, ignores the toggle, and runs on the nudge', async () => {
    const dav = await davMock()
    process.env.EWE_SYNC_URL = dav.url
    const dir = temp('svc')
    const settings = new SettingsStore(dir)
    const bookmarks = new BookmarksStore(dir)
    const history = new HistoryStore(dir)
    await settings.load()
    await bookmarks.load()
    await history.load()
    let state: EweSyncState = { managed: true, signedIn: false, browser: null }
    const ewe = Object.assign(new EventEmitter(), { current: () => state })
    const sync = new SyncService({ userData: dir, settings, bookmarks, history, ewe })
    try {
      sync.start()
      settings.update({ sync: true })
      expect(sync.status()).toMatchObject({ enabled: false, managed: true, signedIn: false })
      state = { managed: true, signedIn: true, browser: null }
      ewe.emit('change')
      expect(sync.status()).toMatchObject({ enabled: true, managed: true, signedIn: true })
      ewe.emit('nudge')
      await waitFor(() => sync.status().lastSync !== null)
      expect(sync.status()).toMatchObject({ state: 'idle', error: null })
      expect(dav.read('bookmarks.json')).not.toBeNull()
      state = { managed: true, signedIn: true, browser: false }
      ewe.emit('change')
      expect(sync.status()).toMatchObject({ enabled: false, state: 'off' })
    } finally {
      sync.dispose()
      history.close()
      delete process.env.EWE_SYNC_URL
      await dav.close()
    }
  })
})
