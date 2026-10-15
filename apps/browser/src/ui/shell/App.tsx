import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js'
import { EDGE_LEAVE_ZONE, EDGE_ZONE, type Rect } from '@ewe/shared'
import { Rail } from '../components/Rail'
import { api } from '../lib/api'
import { createDownloads, isActiveDownload } from '../lib/downloads'
import { applyTheme, createBrowserStore } from '../lib/store'
import './App.css'

const REVEAL_THROTTLE_MS = 300

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.right) - Math.round(r.left),
    height: Math.round(r.bottom) - Math.round(r.top),
  }
}

export function ShellApp(): JSX.Element {
  const store = createBrowserStore()
  const downloads = createDownloads()
  const [editRequest, setEditRequest] = createSignal(0)
  const [renameRequest, setRenameRequest] = createSignal({ id: '', n: 0 })
  let slot: HTMLDivElement | undefined

  createEffect(() => applyTheme(store.settings, store.theme))

  const activeDownloads = createMemo(() => downloads().filter(isActiveDownload).length)
  const collapsed = () => store.settings().rail === 'collapsed'
  const fullscreen = () => store.state()?.fullscreen ?? false
  const hidden = () => collapsed() || fullscreen()

  onMount(() => {
    const off = api.onUi((event) => {
      if (event.type === 'focus-address') setEditRequest((n) => n + 1)
      else if (event.type === 'workspace.rename')
        setRenameRequest((r) => ({ id: event.id, n: r.n + 1 }))
    })
    onCleanup(off)
  })

  onMount(() => {
    let lastX = Number.POSITIVE_INFINITY
    let sentAt = 0
    const reveal = () => {
      if (!collapsed() || fullscreen() || Date.now() - sentAt < REVEAL_THROTTLE_MS) return
      sentAt = Date.now()
      void api.send({ type: 'overlay.request', part: 'rail' })
    }
    const onMove = (e: MouseEvent) => {
      lastX = e.clientX
      if (e.clientX <= EDGE_ZONE) reveal()
    }
    const onLeave = (e: MouseEvent) => {
      if (Math.min(e.clientX, lastX) <= EDGE_LEAVE_ZONE) reveal()
      lastX = Number.POSITIVE_INFINITY
    }
    const root = document.documentElement
    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    onCleanup(() => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
    })
  })

  onMount(() => {
    if (slot === undefined) return
    const el = slot
    const report = () => void api.send({ type: 'layout.report', page: rectOf(el) })
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    report()
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    })
  })

  return (
    <div
      class="shell"
      classList={{ fullscreen: fullscreen(), 'rail-hidden': hidden() }}
      style={{ 'padding-right': `${store.state()?.sidebar?.width ?? 0}px` }}
    >
      <Show when={!hidden()}>
        <div class="shell-rail">
          <Rail
            store={store}
            mode="expanded"
            downloadsActive={activeDownloads()}
            editRequest={editRequest()}
            renameRequest={renameRequest()}
          />
        </div>
      </Show>
      <div class="page-slot" ref={slot} />
    </div>
  )
}
