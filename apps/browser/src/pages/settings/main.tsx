import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import {
  extensionIconUrl,
  type SyncStatus,
  storeExtensionId,
  DEFAULT_SHORTCUTS,
  SEARCH_ENGINES,
  SHORTCUT_IDS,
  SHORTCUT_LABELS,
  chordFromInput,
  chordParts,
  countBookmarks,
  effectiveShortcuts,
  shortcutConflicts,
  expandChord,
  type SearchEngineId,
  type Settings,
  type ShortcutId,
  type ShortcutMap,
} from '@ewe/shared'
import '../../ui/styles/base.css'
import '../pages.css'
import { Icon, type IconName } from '../../ui/components/Icon'
import { createExtensions } from '../../ui/lib/extensions'
import { api } from '../../ui/lib/api'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'
import { GestureRows } from './gesture-rows'
import { HistoryRows } from './history-rows'
import { Privacy } from './privacy'

function SettingRow(props: {
  icon: IconName
  title: string
  description: string
  children: JSX.Element
}): JSX.Element {
  return (
    <div class="row">
      <span class="row-tile">
        <Icon name={props.icon} />
      </span>
      <span class="row-text">
        <span class="row-title">{props.title}</span>
        <span class="row-desc">{props.description}</span>
      </span>
      <span class="select">
        {props.children}
        <Icon name="chevron-down" />
      </span>
    </div>
  )
}

function Chord(props: { chord: string }): JSX.Element {
  return (
    <span class="kbd-combo">
      <For each={chordParts(props.chord)}>{(part) => <span class="kbd">{part}</span>}</For>
    </span>
  )
}

function sameChords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i])
}

function Shortcuts(props: {
  settings: () => Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  const [recording, setRecording] = createSignal<ShortcutId | null>(null)
  const [hint, setHint] = createSignal<string | null>(null)
  const overrides = () => props.settings().shortcuts
  const effective = () => effectiveShortcuts(overrides())
  const conflicts = () => shortcutConflicts(overrides())

  const save = (id: ShortcutId, chords: string[] | null) => {
    const next: ShortcutMap = Object.fromEntries(
      Object.entries(overrides()).filter(([key]) => key !== id),
    )
    if (chords !== null && !sameChords(chords, DEFAULT_SHORTCUTS[id])) next[id] = chords
    props.update({ shortcuts: next })
  }

  const stop = () => {
    if (recording() === null) return
    setRecording(null)
    setHint(null)
    void api.send({ type: 'shortcuts.recording', on: false })
  }

  const onKey = (event: KeyboardEvent) => {
    const id = recording()
    if (id === null) return
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    if (event.code === 'Escape') {
      stop()
      return
    }
    if (event.code === 'Backspace') {
      save(id, null)
      stop()
      return
    }
    const chord = chordFromInput(
      {
        type: 'keyDown',
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      },
      id === 'tab.select' || id === 'workspace.select',
    )
    if (chord === null) {
      if (!/^(Control|Shift|Alt|Meta)/.test(event.code)) setHint('Hold Ctrl or Alt with a key')
      return
    }
    save(id, [chord])
    stop()
  }

  const start = (id: ShortcutId) => {
    if (recording() === id) {
      stop()
      return
    }
    if (recording() === null) void api.send({ type: 'shortcuts.recording', on: true })
    setHint(null)
    setRecording(id)
  }

  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', stop)
  onCleanup(() => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', stop)
    stop()
  })

  const warning = (id: ShortcutId): string | null => {
    for (const chord of effective()[id].flatMap(expandChord)) {
      const others = conflicts()
        .get(chord)
        ?.filter((other) => other !== id)
      if (others !== undefined && others.length > 0)
        return `${chord} is also bound to ${others.map((o) => SHORTCUT_LABELS[o]).join(', ')}`
    }
    return null
  }

  return (
    <>
      <div class="section-bar">
        <h2 class="section-header">Keyboard shortcuts</h2>
        <button
          class="btn btn--ghost btn--sm"
          disabled={Object.keys(overrides()).length === 0}
          onClick={() => props.update({ shortcuts: {} })}
        >
          Reset all
        </button>
      </div>
      <div class="list shortcuts">
        <For each={SHORTCUT_IDS}>
          {(id) => (
            <div class="row shortcut" classList={{ recording: recording() === id }}>
              <span class="row-text">
                <span class="row-title">{SHORTCUT_LABELS[id]}</span>
                <Show when={recording() === id}>
                  <span class="row-desc">
                    {hint() ?? 'Esc cancels, Backspace restores the default'}
                  </span>
                </Show>
                <Show when={recording() !== id && warning(id)}>
                  {(text) => <span class="row-desc row-warning">{text()}</span>}
                </Show>
              </span>
              <span class="chords">
                <Show
                  when={recording() === id}
                  fallback={<For each={effective()[id]}>{(chord) => <Chord chord={chord} />}</For>}
                >
                  <span class="recording-hint">Press keys…</span>
                </Show>
              </span>
              <button class="btn btn--secondary btn--sm" onClick={() => start(id)}>
                {recording() === id ? 'Cancel' : 'Edit'}
              </button>
            </div>
          )}
        </For>
      </div>
    </>
  )
}

function Bookmarks(props: { count: number }): JSX.Element {
  const [result, setResult] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  onMount(() => {
    const off = api.onUi((event) => {
      if (event.type !== 'toast') return
      setResult(event.message)
      setBusy(false)
    })
    onCleanup(off)
  })
  const importChrome = () => {
    setBusy(true)
    setResult(null)
    void api.send({ type: 'bookmarks.importChrome' })
  }
  return (
    <>
      <h2 class="section-header">Bookmarks</h2>
      <div class="list">
        <div class="row">
          <span class="row-tile">
            <Icon name="import" />
          </span>
          <span class="row-text">
            <span class="row-title">Import bookmarks from Chrome</span>
            <span class="row-desc">
              {result() ??
                `Reads the Bookmarks file of your Chrome or Chromium profile into a dated folder. You have ${props.count} bookmark${props.count === 1 ? '' : 's'}.`}
            </span>
          </span>
          <button
            class="btn btn--secondary btn--sm settings-import"
            disabled={busy()}
            onClick={importChrome}
          >
            {busy() ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </>
  )
}

function Files(): JSX.Element {
  const [status, setStatus] = createSignal<{ isDefault: boolean; current: string | null } | null>(
    null,
  )
  const [busy, setBusy] = createSignal(false)
  onMount(() => {
    void api.defaultHandler().then(setStatus)
  })
  const toggle = () => {
    const on = !(status()?.isDefault ?? false)
    setBusy(true)
    void api.defaultHandler(on).then((next) => {
      setStatus(next)
      setBusy(false)
    })
  }
  const describe = () => {
    const s = status()
    if (s === null) return 'Checking which app opens folders…'
    if (s.isDefault) return 'Folders you open from other apps open here.'
    const app = s.current?.replace(/\.desktop$/, '') ?? 'nothing'
    return `Folders currently open in ${app}. Type a path like ~/Downloads in the address field to browse here anyway.`
  }
  return (
    <>
      <h2 class="section-header">Files</h2>
      <div class="list">
        <div class="row">
          <span class="row-tile">
            <Icon name="folder" />
          </span>
          <span class="row-text">
            <span class="row-title">Open folders with ewe browser</span>
            <span class="row-desc">{describe()}</span>
          </span>
          <button
            class="btn btn--secondary btn--sm settings-default-folders"
            disabled={busy() || status() === null}
            onClick={toggle}
          >
            {status()?.isDefault === true ? 'Give back' : 'Use ewe browser'}
          </button>
        </div>
      </div>
    </>
  )
}

function Extensions(): JSX.Element {
  const state = createExtensions()
  const [link, setLink] = createSignal('')
  const add = () => {
    if (storeExtensionId(link()) === null) return
    void api.send({ type: 'extension.install', source: link() })
    setLink('')
  }
  return (
    <>
      <h2 class="section-header">Extensions</h2>
      <div class="list">
        <div class="row">
          <span class="row-tile">
            <Icon name="puzzle" />
          </span>
          <span class="row-text">
            <span class="row-title">Chrome Web Store</span>
            <span class="row-desc">
              Open an extension on the store and press “Add to ewe browser” under the address field.
              Extensions update by themselves; their buttons sit there too.
            </span>
          </span>
          <button
            class="btn btn--ghost btn--sm settings-ext-update"
            disabled={state().list.length === 0}
            onClick={() => void api.send({ type: 'extensions.update' })}
          >
            Update
          </button>
          <button
            class="btn btn--secondary btn--sm settings-ext-store"
            onClick={() =>
              void api.send({ type: 'tab.create', url: 'https://chromewebstore.google.com/' })
            }
          >
            Open store
          </button>
        </div>
        <div class="list-divider" />
        <div class="row">
          <span class="row-tile">
            <Icon name="plus" />
          </span>
          <span class="row-text">
            <span class="row-title">Add by link or ID</span>
            <span class="row-desc">
              Paste a Chrome Web Store link, or the 32-letter extension ID.
            </span>
          </span>
          <input
            class="settings-ext-link"
            value={link()}
            placeholder="chromewebstore.google.com/detail/…"
            spellcheck={false}
            aria-label="Chrome Web Store link or extension ID"
            onInput={(e) => setLink(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
          <button
            class="btn btn--secondary btn--sm settings-ext-add"
            disabled={storeExtensionId(link()) === null}
            onClick={add}
          >
            Add
          </button>
        </div>
        <For each={state().list}>
          {(info) => (
            <>
              <div class="list-divider" />
              <div class="row settings-extension" data-extension={info.id}>
                <span class="row-tile">
                  <img class="ext-tile" src={extensionIconUrl(state(), info)} alt="" />
                </span>
                <span class="row-text">
                  <span class="row-title">
                    {info.name} <span class="row-meta">{info.version}</span>
                  </span>
                  <span class="row-desc">{info.description}</span>
                </span>
                <Show when={info.optionsUrl !== null}>
                  <button
                    class="btn btn--ghost btn--sm"
                    onClick={() => void api.send({ type: 'extension.options', id: info.id })}
                  >
                    Options
                  </button>
                </Show>
                <button
                  class="btn btn--ghost btn--sm settings-ext-remove"
                  onClick={() => void api.send({ type: 'extension.remove', id: info.id })}
                >
                  Remove
                </button>
              </div>
            </>
          )}
        </For>
      </div>
    </>
  )
}

function Sync(props: {
  settings: () => Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  const [status, setStatus] = createSignal<SyncStatus | null>(null)
  onMount(() => {
    const off = api.onSync(setStatus)
    void api.sync().then((next) => {
      if (next !== null) setStatus(next)
    })
    onCleanup(off)
  })
  const describe = () => {
    const s = status()
    if (!props.settings().sync)
      return 'Off. Bookmarks, history, open tabs and settings stay on this computer.'
    if (s === null || s.state === 'off') return 'Starting…'
    if (s.state === 'syncing') return 'Syncing…'
    if (s.state === 'error') return s.error ?? 'Sync failed'
    const when =
      s.lastSync === null
        ? 'not yet'
        : new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `Synced ${when}${s.account === null ? '' : ` · ${s.account}`}`
  }
  return (
    <>
      <h2 class="section-header">Sync</h2>
      <div class="list">
        <SettingRow
          icon="refresh-cw"
          title="Sync with Nextcloud"
          description="Bookmarks, history (deletions too), open tabs, shortcuts, panels and appearance, in ewe/browser on your ewe Nextcloud account. Tabs from your other computers show on the history page."
        >
          <select
            aria-label="Sync with Nextcloud"
            class="settings-sync"
            value={props.settings().sync ? 'on' : 'off'}
            onChange={(e) => props.update({ sync: e.currentTarget.value === 'on' })}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingRow>
        <div class="list-divider" />
        <div class="row">
          <span class="row-tile" classList={{ 'row-tile--alert': status()?.state === 'error' }}>
            <Icon name={status()?.state === 'error' ? 'circle-alert' : 'cloud'} />
          </span>
          <span class="row-text">
            <span class="row-title">Status</span>
            <span class="row-desc settings-sync-status">{describe()}</span>
            <Show when={props.settings().sync ? status()?.warning : null}>
              {(warning) => (
                <span class="row-desc row-warning settings-sync-warning">{warning()}</span>
              )}
            </Show>
          </span>
          <button
            class="btn btn--secondary btn--sm settings-sync-now"
            disabled={!props.settings().sync || status()?.state === 'syncing'}
            onClick={() => void api.sync(true).then((next) => next !== null && setStatus(next))}
          >
            Sync now
          </button>
        </div>
      </div>
    </>
  )
}

function Ewe(props: {
  settings: () => Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  const [startup, setStartup] = createSignal<{ available: boolean; on: boolean } | null>(null)
  const [busy, setBusy] = createSignal(false)
  onMount(() => {
    void api.startup().then(setStartup)
  })
  const toggleStartup = () => {
    const on = !(startup()?.on ?? false)
    setBusy(true)
    void api.startup(on).then((next) => {
      setStartup(next)
      setBusy(false)
      if (on && !props.settings().background) props.update({ background: true })
    })
  }
  const startupDesc = () => {
    const s = startup()
    if (s === null) return 'Checking ewe startup apps…'
    if (!s.available) return 'ewe-conf was not found, so startup apps cannot be changed here.'
    return s.on
      ? 'Starts hidden when you log in, so the first window opens instantly.'
      : 'Add ewe browser to ewe startup apps, hidden until you open a window.'
  }
  return (
    <>
      <h2 class="section-header">ewe</h2>
      <div class="list">
        <SettingRow
          icon="zap"
          title="Keep running in the background"
          description="Closing the last window keeps the browser loaded, so the next one opens instantly."
        >
          <select
            aria-label="Keep running in the background"
            class="settings-background"
            value={props.settings().background ? 'on' : 'off'}
            onChange={(e) => props.update({ background: e.currentTarget.value === 'on' })}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingRow>
        <div class="list-divider" />
        <div class="row">
          <span class="row-tile">
            <Icon name="power" />
          </span>
          <span class="row-text">
            <span class="row-title">Start with ewe</span>
            <span class="row-desc">{startupDesc()}</span>
          </span>
          <button
            class="btn btn--secondary btn--sm settings-startup"
            disabled={busy() || startup()?.available !== true}
            onClick={toggleStartup}
          >
            {startup()?.on === true ? 'Turn off' : 'Turn on'}
          </button>
        </div>
        <div class="list-divider" />
        <SettingRow
          icon="key-round"
          title="Fill from Safe"
          description="A key in login fields lists the Safe logins for that site. Nothing is filled until you pick one."
        >
          <select
            aria-label="Fill from Safe"
            class="settings-safe-fill"
            value={props.settings().safe.fill ? 'on' : 'off'}
            onChange={(e) =>
              props.update({
                safe: { ...props.settings().safe, fill: e.currentTarget.value === 'on' },
              })
            }
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingRow>
        <div class="list-divider" />
        <SettingRow
          icon="list"
          title="Show suggestions when a field gets focus"
          description="Clicking or tabbing into a login field opens the Safe list under it. Off: only the key in the field opens it."
        >
          <select
            aria-label="Show suggestions when a field gets focus"
            class="settings-safe-suggest"
            value={props.settings().safe.suggest ? 'on' : 'off'}
            onChange={(e) =>
              props.update({
                safe: { ...props.settings().safe, suggest: e.currentTarget.value === 'on' },
              })
            }
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingRow>
        <div class="list-divider" />
        <SettingRow
          icon="fingerprint"
          title="Passkeys"
          description="Sites can save passkeys in Safe and sign you in with them. Off: the browser's own passkey support (security keys)."
        >
          <select
            aria-label="Passkeys"
            class="settings-safe-passkeys"
            value={props.settings().safe.passkeys ? 'on' : 'off'}
            onChange={(e) =>
              props.update({
                safe: { ...props.settings().safe, passkeys: e.currentTarget.value === 'on' },
              })
            }
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingRow>
        <div class="list-divider" />
        <SettingRow
          icon="lock"
          title="Offer to save logins"
          description="After you sign in, Safe asks to save a new login or update a changed password."
        >
          <select
            aria-label="Offer to save logins"
            class="settings-safe-save"
            value={props.settings().safe.offerSave ? 'on' : 'off'}
            onChange={(e) =>
              props.update({
                safe: { ...props.settings().safe, offerSave: e.currentTarget.value === 'on' },
              })
            }
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingRow>
        <For each={props.settings().safe.neverSave}>
          {(host) => (
            <div class="row settings-safe-never">
              <span class="row-tile">
                <Icon name="globe" />
              </span>
              <span class="row-text">
                <span class="row-title">{host}</span>
                <span class="row-desc">Safe never offers to save here</span>
              </span>
              <button
                class="btn btn--ghost btn--sm"
                onClick={() =>
                  props.update({
                    safe: {
                      ...props.settings().safe,
                      neverSave: props.settings().safe.neverSave.filter((h) => h !== host),
                    },
                  })
                }
              >
                Remove
              </button>
            </div>
          )}
        </For>
        <div class="list-divider" />
        <div class="row">
          <span class="row-tile">
            <Icon name="key-round" />
          </span>
          <span class="row-text">
            <span class="row-title">Safe only</span>
            <span class="row-desc settings-safe-only">
              Ctrl+Shift+L, the key in the address field and the right-click menu open Safe for the
              sign-in field. Password-manager extensions (1Password, Bitwarden, LastPass and others)
              cannot be added and are turned off.
            </span>
          </span>
        </div>
        <div class="list-divider" />
        <div class="row">
          <span class="row-tile">
            <Icon name="panel-right" />
          </span>
          <span class="row-text">
            <span class="row-title">Web panels</span>
            <span class="row-desc">
              {props.settings().panels.length === 0
                ? 'Open a site, then press + in the sidebar to keep it there as a panel.'
                : 'Sites kept in the sidebar. They stay loaded while the window is open.'}
            </span>
          </span>
        </div>
        <For each={props.settings().panels}>
          {(panel) => (
            <div class="row settings-panel">
              <span class="row-tile">
                <Icon name="globe" />
              </span>
              <span class="row-text">
                <span class="row-title">{panel.title}</span>
                <span class="row-desc">{panel.url}</span>
              </span>
              <button
                class="btn btn--ghost btn--sm"
                onClick={() =>
                  props.update({
                    panels: props.settings().panels.filter((p) => p.id !== panel.id),
                  })
                }
              >
                Remove
              </button>
            </div>
          )}
        </For>
      </div>
    </>
  )
}

function SettingsPage(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))
  const update = (patch: Partial<Settings>) => void api.send({ type: 'settings.update', patch })
  const bookmarkCount = () => {
    const root = store.bookmarks()
    return root === null ? 0 : countBookmarks(root)
  }

  return (
    <div class="page">
      <div class="settings">
        <div class="settings-head">
          <h1>Settings</h1>
          <p>Changes apply right away.</p>
        </div>
        <h2 class="section-header">Appearance</h2>
        <div class="list">
          <SettingRow
            icon="panel-left"
            title="Tabs"
            description="The tab rail on the left. Collapsed shows icons and opens on hover. Ctrl+Shift+S switches."
          >
            <select
              aria-label="Tabs"
              value={store.settings().rail}
              onChange={(e) => update({ rail: e.currentTarget.value as Settings['rail'] })}
            >
              <option value="expanded">Expanded</option>
              <option value="collapsed">Collapsed</option>
            </select>
          </SettingRow>
          <div class="list-divider" />
          <SettingRow
            icon="moon"
            title="Theme"
            description="Ewe desktop follows the scheme and accent from your ewe.conf."
          >
            <select
              aria-label="Theme"
              value={store.settings().theme}
              onChange={(e) => update({ theme: e.currentTarget.value as Settings['theme'] })}
            >
              <option value="system">Ewe desktop</option>
              <option value="light">Ewe Light</option>
              <option value="dark">Ewe Dark</option>
            </select>
          </SettingRow>
        </div>
        <h2 class="section-header">Browsing</h2>
        <div class="list">
          <SettingRow
            icon="search"
            title="Search engine"
            description="Used for plain text and for the w: prefix."
          >
            <select
              aria-label="Search engine"
              value={store.settings().searchEngine}
              onChange={(e) => update({ searchEngine: e.currentTarget.value as SearchEngineId })}
            >
              <For each={Object.entries(SEARCH_ENGINES)}>
                {([id, engine]) => <option value={id}>{engine.name}</option>}
              </For>
            </select>
          </SettingRow>
          <div class="list-divider" />
          <SettingRow
            icon="history"
            title="Restore session"
            description="Reopen windows and tabs from the last run."
          >
            <select
              aria-label="Restore session"
              value={store.settings().restoreSession ? 'on' : 'off'}
              onChange={(e) => update({ restoreSession: e.currentTarget.value === 'on' })}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </SettingRow>
          <HistoryRows settings={() => store.settings()} update={update} />
          <GestureRows settings={() => store.settings()} update={update} />
        </div>
        <Privacy settings={() => store.settings()} update={update} />
        <Bookmarks count={bookmarkCount()} />
        <Files />
        <Extensions />
        <Sync settings={() => store.settings()} update={update} />
        <Ewe settings={() => store.settings()} update={update} />
        <Shortcuts settings={() => store.settings()} update={update} />
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <SettingsPage />, root)
