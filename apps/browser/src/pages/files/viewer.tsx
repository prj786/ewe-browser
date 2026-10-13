import {
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js'
import { fileKind, type FsEntry } from '@ewe/shared'
import { Icon } from '../../ui/components/Icon'
import { formatBytes } from '../../ui/lib/format'
import { TextView } from './textview'

export interface MediaViewerProps {
  items: FsEntry[]
  index: number
  token: string
  onIndex: (index: number) => void
  onClose: () => void
  onNewTab: (entry: FsEntry) => void
  onExternal: (entry: FsEntry) => void
  onMpv: (entry: FsEntry) => void
}

export function rawUrl(path: string, token: string): string {
  const name = encodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
  return `app://files/raw/${name}?${new URLSearchParams({ path, t: token }).toString()}`
}

export function MediaViewer(props: MediaViewerProps): JSX.Element {
  const [actual, setActual] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const entry = () => props.items[props.index]
  const count = () => props.items.length
  const kind = () => {
    const e = entry()
    return e === undefined ? 'other' : fileKind(e)
  }

  createEffect(
    on(
      () => entry()?.path,
      () => {
        setActual(false)
        setFailed(false)
      },
    ),
  )

  const step = (delta: number) => {
    if (count() < 2) return
    props.onIndex((props.index + delta + count()) % count())
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'Home') props.onIndex(0)
      else if (e.key === 'End') props.onIndex(count() - 1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    onCleanup(() => window.removeEventListener('keydown', onKey, true))
  })

  const preload = () => {
    for (const delta of [1, -1]) {
      const next = props.items[(props.index + delta + count()) % count()]
      if (next !== undefined && fileKind(next) === 'image') {
        const img = new Image()
        img.src = rawUrl(next.path, props.token)
      }
    }
  }

  return (
    <Show when={entry()}>
      {(current) => (
        <div class="mv" role="dialog" aria-label={current().name}>
          <header class="mv-top">
            <span class="mv-title">
              <span class="mv-name">{current().name}</span>
              <span class="mv-meta">
                {count() > 1 ? `${props.index + 1} of ${count()} · ` : ''}
                {formatBytes(current().size)}
              </span>
            </span>
            <button
              class="iconbtn mv-btn mv-tab"
              title="Open in new tab"
              aria-label="Open in new tab"
              onClick={() => props.onNewTab(current())}
            >
              <Icon name="app-window" />
            </button>
            <Show when={kind() === 'video'}>
              <button
                class="iconbtn mv-btn mv-mpv"
                title="Play in mpv"
                aria-label="Play in mpv"
                onClick={() => props.onMpv(current())}
              >
                <Icon name="play" />
              </button>
            </Show>
            <button
              class="iconbtn mv-btn"
              title="Open with the default app"
              aria-label="Open with the default app"
              onClick={() => props.onExternal(current())}
            >
              <Icon name="external-link" />
            </button>
            <button
              class="iconbtn mv-btn mv-close"
              title="Close (Esc)"
              aria-label="Close"
              onClick={() => props.onClose()}
            >
              <Icon name="x" />
            </button>
          </header>
          <div
            class="mv-stage"
            classList={{ actual: actual() }}
            onClick={(e) => {
              if (e.target === e.currentTarget) props.onClose()
            }}
          >
            <Show
              when={!failed()}
              fallback={
                <div class="mv-failed">
                  <Icon name="circle-alert" size={32} />
                  <span>This file cannot be shown here.</span>
                  <Show when={kind() === 'video'}>
                    <button class="btn btn--primary btn--sm" onClick={() => props.onMpv(current())}>
                      Play in mpv
                    </button>
                  </Show>
                  <button
                    class="btn btn--secondary btn--sm"
                    onClick={() => props.onExternal(current())}
                  >
                    Open with the default app
                  </button>
                </div>
              }
            >
              <Switch>
                <Match when={kind() === 'image'}>
                  <img
                    class="mv-image"
                    src={rawUrl(current().path, props.token)}
                    alt={current().name}
                    draggable={false}
                    onLoad={preload}
                    onError={() => setFailed(true)}
                    onClick={() => setActual((a) => !a)}
                  />
                </Match>
                <Match when={kind() === 'video'}>
                  <video
                    class="mv-video"
                    src={rawUrl(current().path, props.token)}
                    controls
                    autoplay
                    onError={() => setFailed(true)}
                  />
                </Match>
                <Match when={kind() === 'text' || kind() === 'code' || kind() === 'pdf'}>
                  <TextView entry={current()} rawUrl={(p) => rawUrl(p, props.token)} />
                </Match>
                <Match when={kind() === 'audio'}>
                  <div class="mv-audio">
                    <span class="mv-audio-art">
                      <Icon name="music" size={48} />
                    </span>
                    <span class="mv-audio-name">{current().name}</span>
                    <audio
                      src={rawUrl(current().path, props.token)}
                      controls
                      autoplay
                      onError={() => setFailed(true)}
                      onEnded={() => step(1)}
                    />
                  </div>
                </Match>
              </Switch>
            </Show>
          </div>
          <Show when={count() > 1}>
            <button class="mv-nav prev" aria-label="Previous" onClick={() => step(-1)}>
              <Icon name="chevron-left" size={24} />
            </button>
            <button class="mv-nav next" aria-label="Next" onClick={() => step(1)}>
              <Icon name="chevron-right" size={24} />
            </button>
          </Show>
        </div>
      )}
    </Show>
  )
}
