import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import {
  PERMISSION_LABELS,
  PERMISSION_HINTS,
  placeMenu,
  type PermissionKind,
  type PermissionValue,
  type Point,
  type SiteInfo,
} from '@ewe/shared'
import { PERMISSION_ICONS } from '../lib/permissions'
import { Icon, type IconName } from './Icon'
import './Privacy.css'

const VALUES: { value: PermissionValue; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'allow', label: 'Allow' },
  { value: 'block', label: 'Block' },
]

function status(info: SiteInfo): { icon: IconName; title: string; detail: string; tone: string } {
  switch (info.kind) {
    case 'https':
      return {
        icon: 'shield-check',
        title: 'Connection is secure',
        detail: 'What you send and see here is encrypted on the way.',
        tone: 'secure',
      }
    case 'http':
      return {
        icon: 'triangle-alert',
        title: 'Connection is not secure',
        detail: info.httpAllowed
          ? 'You chose to continue over http for this site until ewe Browser closes.'
          : 'Do not enter passwords or card numbers: others on the network can read or change this page.',
        tone: 'insecure',
      }
    case 'file':
      return {
        icon: 'file',
        title: 'Local file',
        detail: 'This page is a file on your computer.',
        tone: 'local',
      }
    default:
      return { icon: 'globe', title: 'Site', detail: '', tone: 'local' }
  }
}

export function SiteInfoPanel(props: {
  info: SiteInfo
  at: Point
  leaving: boolean
  onSet(kind: PermissionKind, value: PermissionValue): void
  onClear(): void
  onSettings(): void
  onClose(): void
}): JSX.Element {
  const [pos, setPos] = createSignal<Point>({ x: 0, y: 0 })
  let panel: HTMLDivElement | undefined

  const place = () => {
    if (panel === undefined) return
    const r = panel.getBoundingClientRect()
    setPos(
      placeMenu(
        props.at,
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }

  onMount(() => {
    place()
    panel?.focus()
    window.addEventListener('resize', place)
    const onBlur = () => props.onClose()
    window.addEventListener('blur', onBlur)
    onCleanup(() => {
      window.removeEventListener('resize', place)
      window.removeEventListener('blur', onBlur)
    })
  })

  const s = () => status(props.info)
  const web = () => props.info.origin !== ''

  return (
    <div
      ref={panel}
      class="site-info"
      classList={{ leaving: props.leaving }}
      style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
      role="dialog"
      aria-label={`Site information for ${props.info.host}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          props.onClose()
        }
      }}
    >
      <div class="site-info-head" data-tone={s().tone}>
        <span class="site-info-icon">
          <Icon name={s().icon} />
        </span>
        <span class="site-info-text">
          <span class="site-info-host">{props.info.host}</span>
          <span class="site-info-status">{s().title}</span>
        </span>
      </div>
      <Show when={s().detail !== ''}>
        <p class="site-info-detail">{s().detail}</p>
      </Show>
      <Show when={web() && props.info.permissions.length > 0}>
        <div class="site-info-section">Permissions</div>
        <For each={props.info.permissions}>
          {(row) => (
            <div class="site-perm" data-kind={row.kind}>
              <span class="site-perm-icon">
                <Icon name={PERMISSION_ICONS[row.kind]} />
              </span>
              <span class="site-perm-text">
                <span>{PERMISSION_LABELS[row.kind]}</span>
                <Show when={PERMISSION_HINTS[row.kind]}>
                  {(note) => <span class="site-perm-note">{note()}</span>}
                </Show>
              </span>
              <span class="seg" role="radiogroup" aria-label={PERMISSION_LABELS[row.kind]}>
                <For each={VALUES}>
                  {(v) => (
                    <button
                      class="seg-item"
                      classList={{ on: row.value === v.value }}
                      role="radio"
                      aria-checked={row.value === v.value}
                      data-value={v.value}
                      onClick={() => props.onSet(row.kind, v.value)}
                    >
                      {v.label}
                    </button>
                  )}
                </For>
              </span>
            </div>
          )}
        </For>
      </Show>
      <div class="site-info-actions">
        <Show when={web()}>
          <button class="btn btn--ghost btn--sm site-info-clear" onClick={() => props.onClear()}>
            <Icon name="trash-2" />
            Clear site data
          </button>
        </Show>
        <span class="site-info-spacer" />
        <button
          class="btn btn--secondary btn--sm site-info-settings"
          onClick={() => props.onSettings()}
        >
          <Icon name="settings" />
          Site settings
        </button>
      </div>
    </div>
  )
}
