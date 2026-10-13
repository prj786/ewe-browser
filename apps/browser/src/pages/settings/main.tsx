import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import {
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
import { api } from '../../ui/lib/api'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'

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
        <div class="row">
          <span class="row-tile">
            <Icon name="key-round" />
          </span>
          <span class="row-text">
            <span class="row-title">Passwords</span>
            <span class="row-desc">
              Ctrl+Shift+L or the key in the address field fills a login from 1Password, Bitwarden
              or pass through ewe Passwords. Secrets never pass through the browser.
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
        </div>
        <Bookmarks count={bookmarkCount()} />
        <Files />
        <Ewe settings={() => store.settings()} update={update} />
        <Shortcuts settings={() => store.settings()} update={update} />
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <SettingsPage />, root)
