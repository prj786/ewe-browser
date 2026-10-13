import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js'
import type { Rect } from '@ewe/shared'
import { Rail } from '../components/Rail'
import { api } from '../lib/api'
import { createDownloads, isActiveDownload } from '../lib/downloads'
import { applyTheme, createBrowserStore } from '../lib/store'
import './App.css'

const PEEK_DELAY_MS = 250

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  }
}

export function ShellApp(): JSX.Element {
  const store = createBrowserStore()
  const downloads = createDownloads()
  const [editRequest, setEditRequest] = createSignal(0)
  const [renameRequest, setRenameRequest] = createSignal({ id: '', n: 0 })
  let slot: HTMLDivElement | undefined
  let peekTimer: number | undefined

  createEffect(() => applyTheme(store.settings, store.theme))

  const activeDownloads = createMemo(() => downloads().filter(isActiveDownload).length)
  const collapsed = () => store.settings().rail === 'collapsed'
  const fullscreen = () => store.state()?.fullscreen ?? false

  onMount(() => {
    const off = api.onUi((event) => {
      if (event.type === 'focus-address') setEditRequest((n) => n + 1)
      else if (event.type === 'workspace.rename')
        setRenameRequest((r) => ({ id: event.id, n: r.n + 1 }))
    })
    onCleanup(() => {
      off()
      window.clearTimeout(peekTimer)
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

  const peek = () => {
    window.clearTimeout(peekTimer)
    if (!collapsed()) return
    peekTimer = window.setTimeout(
      () => void api.send({ type: 'overlay.request', part: 'rail' }),
      PEEK_DELAY_MS,
    )
  }

  return (
    <div
      class="shell"
      classList={{ fullscreen: fullscreen() }}
      style={{ 'padding-right': `${store.state()?.sidebar?.width ?? 0}px` }}
    >
      <Show when={!fullscreen()}>
        <div
          class="shell-rail"
          onMouseEnter={peek}
          onMouseLeave={() => window.clearTimeout(peekTimer)}
          onPointerDown={() => window.clearTimeout(peekTimer)}
        >
          <Rail
            store={store}
            mode={collapsed() ? 'collapsed' : 'expanded'}
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
