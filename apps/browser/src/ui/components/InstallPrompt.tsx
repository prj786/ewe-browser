import { For, Show, onMount, type JSX } from 'solid-js'
import type { ExtensionInstallRequest } from '@ewe/shared'
import { Icon } from './Icon'
import './Palette.css'

const LABELS: Record<string, string> = {
  '<all_urls>': 'Read and change all your data on all websites',
  'https://*/*': 'Read and change all your data on all websites',
  'http://*/*': 'Read and change all your data on all websites',
  '*://*/*': 'Read and change all your data on all websites',
  tabs: 'Read your browsing history',
  history: 'Read and change your browsing history',
  bookmarks: 'Read and change your bookmarks',
  downloads: 'Manage your downloads',
  cookies: 'Read and change cookies',
  clipboardRead: 'Read data you copy and paste',
  clipboardWrite: 'Change data you copy and paste',
  notifications: 'Show notifications',
  webRequest: 'Watch network requests',
  declarativeNetRequest: 'Block content on any page',
  storage: '',
  activeTab: '',
  contextMenus: '',
  scripting: 'Run scripts on pages you allow',
  nativeMessaging: 'Talk to apps on this computer',
}

export function permissionLines(permissions: string[]): string[] {
  const lines: string[] = []
  for (const permission of permissions) {
    const label =
      LABELS[permission] ??
      (/^(\*|https?):\/\//.test(permission)
        ? `Read and change your data on ${permission.replace(/^[^:]+:\/\/(\*\.)?/, '').replace(/\/.*$/, '')}`
        : '')
    if (label !== '' && !lines.includes(label)) lines.push(label)
  }
  return lines
}

export function InstallPrompt(props: {
  request: ExtensionInstallRequest
  onDecide(allow: boolean): void
}): JSX.Element {
  let add: HTMLButtonElement | undefined
  onMount(() => add?.focus())
  const lines = () => permissionLines(props.request.permissions)
  return (
    <div
      class="palette install-prompt"
      role="dialog"
      aria-label={`Add ${props.request.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onDecide(false)
      }}
    >
      <div class="install-head">
        <span class="install-icon">
          <Show when={props.request.icon} fallback={<Icon name="puzzle" size={28} />}>
            {(src) => <img src={src()} alt="" />}
          </Show>
        </span>
        <span class="install-text">
          <span class="install-title">Add “{props.request.name}”?</span>
          <span class="install-sub">From the Chrome Web Store</span>
        </span>
      </div>
      <Show when={lines().length > 0}>
        <div class="install-perms">
          <span class="install-perms-title">It can:</span>
          <ul>
            <For each={lines()}>{(line) => <li>{line}</li>}</For>
          </ul>
        </div>
      </Show>
      <div class="install-actions">
        <button class="btn btn--ghost btn--sm install-cancel" onClick={() => props.onDecide(false)}>
          Cancel
        </button>
        <button
          ref={add}
          class="btn btn--primary btn--sm install-add"
          onClick={() => props.onDecide(true)}
        >
          Add extension
        </button>
      </div>
    </div>
  )
}
