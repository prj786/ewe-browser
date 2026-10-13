import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from 'solid-js'
import {
  type ExtensionInstallRequest,
  type MenuTarget,
  type OverlayPart,
  type Point,
  type ToastIcon,
} from '@ewe/shared'
import { Icon, type IconName } from '../components/Icon'
import { Menu } from '../components/Menu'
import { Passwords } from '../components/Passwords'
import { Palette } from '../components/Palette'
import { Rail } from '../components/Rail'
import { api } from '../lib/api'
import { createDownloads, isActiveDownload } from '../lib/downloads'
import { applyTheme, createBrowserStore } from '../lib/store'
import { tabMenuItems } from './tab-menu'
import { workspaceMenuItems } from './workspace-menu'
import { extensionMenuItems } from './extension-menu'
import { createExtensions } from '../lib/extensions'
import { InstallPrompt } from '../components/InstallPrompt'
import './App.css'

const MENU_FADE_MS = 160

const TOAST_ICONS: Record<ToastIcon, IconName> = {
  star: 'star',
  download: 'download',
  check: 'check',
  alert: 'circle-alert',
}

interface OpenMenu {
  target: MenuTarget
  at: Point
  leaving: boolean
}

export function OverlayApp(): JSX.Element {
  const store = createBrowserStore()
  const [part, setPart] = createSignal<OverlayPart>('none')
  const [leaving, setLeaving] = createSignal(false)
  const [paletteQuery, setPaletteQuery] = createSignal('')
  const [paletteNewTab, setPaletteNewTab] = createSignal(false)
  const [passwordsHost, setPasswordsHost] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal(false)
  const [menu, setMenu] = createSignal<OpenMenu | null>(null)
  const [under, setUnder] = createSignal<'rail' | null>(null)
  const [renameRequest, setRenameRequest] = createSignal({ id: '', n: 0 })
  let pendingRename: string | null = null
  const [toast, setToast] = createSignal<{ message: string; icon: ToastIcon }>({
    message: '',
    icon: 'star',
  })
  const downloads = createDownloads()
  const extensions = createExtensions()
  const [install, setInstall] = createSignal<ExtensionInstallRequest | null>(null)
  const activeDownloads = createMemo(() => downloads().filter(isActiveDownload).length)
  let entered = false

  createEffect(() => applyTheme(store.settings, store.theme))

  const close = () => void api.send({ type: 'overlay.request', part: 'none' })
  const pin = (pinned: boolean) => void api.send({ type: 'overlay.pin', pinned })

  const menuTarget = () => {
    const m = menu()
    const s = store.state()
    if (m === null || s === null) return undefined
    const target = m.target
    if (target.kind === 'tab') {
      const tab = s.tabs.find((t) => t.id === target.id)
      return tab === undefined ? undefined : { kind: 'tab' as const, tab, snapshot: s }
    }
    if (target.kind === 'extension') {
      const info = extensions().list.find((e) => e.id === target.id)
      return info === undefined ? undefined : { kind: 'extension' as const, info }
    }
    const workspace = s.workspaces.find((w) => w.id === target.id)
    return workspace === undefined
      ? undefined
      : { kind: 'workspace' as const, workspace, snapshot: s }
  }
  const menuItems = createMemo(() => {
    const target = menuTarget()
    if (target === undefined) return []
    if (target.kind === 'tab') return tabMenuItems(target.tab, target.snapshot)
    if (target.kind === 'extension') return extensionMenuItems(target.info)
    const id = target.workspace.id
    return workspaceMenuItems(target.workspace, target.snapshot, () => {
      pendingRename = id
    })
  })

  const closeMenu = () => {
    const m = menu()
    if (m === null || m.leaving) return
    setMenu({ ...m, leaving: true })
    const rename = pendingRename
    pendingRename = null
    if (rename !== null) void api.send({ type: 'workspace.rename', id: rename })
    else void api.send({ type: 'overlay.request', part: under() ?? 'none' })
  }

  const fadeMenu = () => {
    const m = untrack(menu)
    if (m === null) return
    const closing = { ...m, leaving: true }
    setMenu(closing)
    setTimeout(() => {
      if (menu() === closing) setMenu(null)
    }, MENU_FADE_MS)
  }

  createEffect(() => {
    if (menu() !== null && menuTarget() === undefined) closeMenu()
  })

  onMount(() => {
    const off = api.onUi((event) => {
      if (event.type === 'overlay.show') {
        setLeaving(false)
        entered = false
        if (event.part === 'menu') {
          const current = untrack(part)
          setUnder(current === 'rail' ? 'rail' : null)
        } else if (event.part === 'rail') fadeMenu()
        else setMenu(null)
        setPart(event.part)
        if (event.part === 'none' || event.part === 'palette') setEditing(false)
        if (event.part !== 'palette') {
          setPasswordsHost(null)
          const pending = untrack(install)
          if (pending !== null) {
            setInstall(null)
            void api.send({ type: 'extension.confirm', requestId: pending.requestId, allow: false })
          }
        }
      } else if (event.type === 'overlay.hide') {
        setLeaving(true)
      } else if (event.type === 'passwords.open') {
        setInstall(null)
        setPasswordsHost(event.host)
      } else if (event.type === 'extension.install') {
        setPasswordsHost(null)
        setInstall(event.request)
      } else if (event.type === 'palette.open') {
        setPasswordsHost(null)
        setPaletteQuery(event.query ?? '')
        setPaletteNewTab(event.newTab ?? false)
      } else if (event.type === 'menu.open') {
        setMenu({ target: event.menu, at: { x: event.x, y: event.y }, leaving: false })
      } else if (event.type === 'workspace.rename') {
        setRenameRequest((r) => ({ id: event.id, n: r.n + 1 }))
      } else if (event.type === 'toast') {
        setToast({ message: event.message, icon: event.icon ?? 'star' })
      }
    })
    const onMove = () => {
      entered = true
    }
    const onLeave = () => {
      if (entered && part() !== 'palette' && part() !== 'menu' && !editing()) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || editing()) return
      if (menu() !== null) closeMenu()
      else close()
    }
    document.documentElement.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    window.addEventListener('keydown', onKey)
    onCleanup(() => {
      off()
      document.documentElement.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keydown', onKey)
    })
  })

  return (
    <div class="overlay">
      <Show when={part() === 'rail' || (part() === 'menu' && under() === 'rail')}>
        <div class="rail-peek-host" classList={{ leaving: leaving() }}>
          <Rail
            store={store}
            mode="peek"
            downloadsActive={activeDownloads()}
            renameRequest={renameRequest()}
            onEditingChange={(on) => {
              setEditing(on)
              pin(on)
            }}
          />
        </div>
      </Show>
      <Show when={part() === 'palette'}>
        <div
          class="overlay-backdrop"
          classList={{ leaving: leaving() }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <Show
            when={install()}
            fallback={
              <Show
                when={passwordsHost() === null}
                fallback={<Passwords host={passwordsHost() ?? ''} onClose={close} />}
              >
                <Palette
                  tabs={store.tabs()}
                  bookmarks={store.bookmarks()}
                  engine={store.settings().searchEngine}
                  initial={paletteQuery()}
                  newTab={paletteNewTab()}
                  onNavigate={(input) =>
                    void api.send({ type: 'tab.navigate', input, newTab: paletteNewTab() })
                  }
                  onActivate={(id) => void api.send({ type: 'tab.activate', id })}
                  onClose={close}
                />
              </Show>
            }
          >
            {(request) => (
              <InstallPrompt
                request={request()}
                onDecide={(allow) => {
                  const requestId = request().requestId
                  setInstall(null)
                  void api.send({ type: 'extension.confirm', requestId, allow })
                }}
              />
            )}
          </Show>
        </div>
      </Show>
      <Show when={menu()}>
        {(m) => (
          <div
            class="menu-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && closeMenu()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Menu
              items={menuItems()}
              at={m().at}
              leaving={m().leaving || leaving()}
              onClose={closeMenu}
            />
          </div>
        )}
      </Show>
      <Show when={part() === 'toast'}>
        <div class="toast-host">
          <div class="toast" classList={{ leaving: leaving() }} role="status">
            <Icon
              name={TOAST_ICONS[toast().icon]}
              class={toast().icon === 'star' ? 'filled' : `toast-${toast().icon}`}
            />
            <span>{toast().message}</span>
          </div>
        </div>
      </Show>
    </div>
  )
}
