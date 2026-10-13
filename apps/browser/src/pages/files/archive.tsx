import { For, Show, onCleanup, onMount, type JSX } from 'solid-js'
import type { ArchiveListing, FsEntry } from '@ewe/shared'
import { Icon } from '../../ui/components/Icon'
import { formatBytes } from '../../ui/lib/format'

export interface ArchiveDialogProps {
  entry: FsEntry
  listing: ArchiveListing | null
  error: string | null
  busy: boolean
  onExtract: () => void
  onExternal: () => void
  onClose: () => void
}

export function ArchiveDialog(props: ArchiveDialogProps): JSX.Element {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
      else if (e.key === 'Enter' && props.listing !== null && !props.busy) props.onExtract()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    onCleanup(() => window.removeEventListener('keydown', onKey, true))
  })

  const summary = () => {
    const l = props.listing
    if (l === null) return props.error ?? 'Reading the archive…'
    return `${l.count} file${l.count === 1 ? '' : 's'} · ${formatBytes(l.size)} unpacked`
  }

  return (
    <div
      class="ad-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class="ad" role="dialog" aria-label={props.entry.name}>
        <header class="ad-head">
          <span class="ad-icon">
            <Icon name="archive" size={20} />
          </span>
          <span class="ad-title">
            <span class="ad-name">{props.entry.name}</span>
            <span class="ad-summary" classList={{ error: props.error !== null }}>
              {summary()}
            </span>
          </span>
        </header>
        <div class="ad-list">
          <For each={props.listing?.entries ?? []}>
            {(item) => {
              const slash = item.name.lastIndexOf('/')
              return (
                <div class="ad-row" classList={{ dir: item.dir }}>
                  <Icon name={item.dir ? 'folder' : 'file'} size={14} />
                  <span class="ad-path">
                    <Show when={slash > 0}>
                      <span class="ad-parent">{item.name.slice(0, slash + 1)}</span>
                    </Show>
                    {item.name.slice(slash + 1)}
                  </span>
                  <span class="ad-size">{item.dir ? '' : formatBytes(item.size)}</span>
                </div>
              )
            }}
          </For>
          <Show when={props.listing?.truncated}>
            <div class="ad-more">and more…</div>
          </Show>
        </div>
        <footer class="ad-foot">
          <span class="ad-hint">
            {props.listing === null
              ? ''
              : props.listing.root === null
                ? 'Extracts into a new folder next to it'
                : `Extracts the folder “${props.listing.root}”`}
          </span>
          <button class="btn btn--ghost btn--sm" onClick={() => props.onExternal()}>
            Archive manager
          </button>
          <button class="btn btn--secondary btn--sm" onClick={() => props.onClose()}>
            Cancel
          </button>
          <button
            class="btn btn--primary btn--sm ad-extract"
            disabled={props.listing === null || props.busy}
            onClick={() => props.onExtract()}
          >
            {props.busy ? 'Extracting…' : 'Extract here'}
          </button>
        </footer>
      </div>
    </div>
  )
}
