import { For, Match, Show, Switch, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import type { PasswordItem, PasswordStatus } from '@ewe/shared'
import { api } from '../lib/api'
import { Icon } from './Icon'
import './Palette.css'

export interface PasswordsProps {
  host: string
  onClose(): void
}

export function Passwords(props: PasswordsProps): JSX.Element {
  const [query, setQuery] = createSignal('')
  const [items, setItems] = createSignal<PasswordItem[]>([])
  const [status, setStatus] = createSignal<PasswordStatus | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [selected, setSelected] = createSignal(0)
  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  let timer = 0
  let seq = 0

  const load = (q: string) => {
    const n = ++seq
    setLoading(true)
    void api.passwords(q).then((result) => {
      if (n !== seq) return
      setStatus(result.status)
      setItems(result.items)
      setSelected(0)
      setLoading(false)
    })
  }

  onMount(() => {
    input?.focus()
    load('')
  })
  onCleanup(() => clearTimeout(timer))

  const onInput = (value: string) => {
    setQuery(value)
    clearTimeout(timer)
    timer = window.setTimeout(() => load(value), 200)
  }

  const fill = (item: PasswordItem, what: 'login' | 'username' | 'password') =>
    void api.send({ type: 'passwords.fill', id: item.id, what })
  const copy = (item: PasswordItem, what: 'username' | 'password') =>
    void api.send({ type: 'passwords.copy', id: item.id, what })

  const move = (delta: number) => {
    const count = items().length
    if (count === 0) return
    setSelected((i) => (i + delta + count) % count)
    list?.children[selected()]?.scrollIntoView({ block: 'nearest' })
  }

  const onKey = (e: KeyboardEvent) => {
    const item = items()[selected()]
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'Escape') props.onClose()
    else if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Enter' && item !== undefined) fill(item, ctrl ? 'password' : 'login')
    else if (
      ctrl &&
      e.key.toLowerCase() === 'c' &&
      item !== undefined &&
      input?.selectionStart === input?.selectionEnd
    )
      copy(item, e.shiftKey ? 'username' : 'password')
    else return
    e.preventDefault()
  }

  return (
    <div class="palette passwords">
      <div class="palette-search">
        <span class="palette-mode search">
          <Icon name="key-round" />
        </span>
        <Show when={props.host !== ''}>
          <span class="palette-chip">{props.host}</span>
        </Show>
        <input
          ref={input}
          value={query()}
          onInput={(e) => onInput(e.currentTarget.value)}
          onKeyDown={onKey}
          placeholder={status()?.provider ? `Search ${status()?.provider}` : 'Search logins'}
          aria-label="Search logins"
          spellcheck={false}
          autocomplete="off"
        />
        <span class="kbd">Esc</span>
      </div>
      <Switch>
        <Match when={status() !== null && status()?.ok !== true}>
          <div class="palette-empty pw-error">
            <Icon name="circle-alert" />
            <span class="palette-text">
              <span class="palette-label">{status()?.error}</span>
              <span class="palette-hint">{status()?.hint ?? ''}</span>
            </span>
          </div>
        </Match>
        <Match when={loading() && items().length === 0}>
          <div class="palette-empty">
            <Icon name="lock" />
            <span>Asking {status()?.provider ?? 'your password manager'}…</span>
          </div>
        </Match>
        <Match when={items().length === 0}>
          <div class="palette-empty">
            <Icon name="search" />
            <span>No logins match</span>
          </div>
        </Match>
        <Match when={items().length > 0}>
          <div class="palette-results" role="listbox" ref={list}>
            <For each={items()}>
              {(item, i) => (
                <div
                  class="palette-row pw-row"
                  classList={{ selected: i() === selected() }}
                  role="option"
                  aria-selected={i() === selected()}
                  onMouseEnter={() => setSelected(i())}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => fill(item, 'login')}
                >
                  <span class="palette-well">
                    <Icon name="key-round" />
                  </span>
                  <span class="palette-text">
                    <span class="palette-label">{item.title}</span>
                    <span class="palette-hint">
                      {[item.username, item.host].filter((t) => t !== '').join(' · ')}
                    </span>
                  </span>
                  <span class="palette-trail pw-actions">
                    <button
                      class="iconbtn iconbtn--sm"
                      title="Copy username"
                      aria-label="Copy username"
                      onClick={(e) => {
                        e.stopPropagation()
                        copy(item, 'username')
                      }}
                    >
                      <Icon name="user" />
                    </button>
                    <button
                      class="iconbtn iconbtn--sm"
                      title="Copy password"
                      aria-label="Copy password"
                      onClick={(e) => {
                        e.stopPropagation()
                        copy(item, 'password')
                      }}
                    >
                      <Icon name="copy" />
                    </button>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <div class="palette-legend">
        <span>
          <span class="kbd">Enter</span> Fill login
        </span>
        <span>
          <span class="kbd-combo">
            <span class="kbd">Ctrl</span>
            <span class="kbd">Enter</span>
          </span>
          Password only
        </span>
        <span>
          <span class="kbd-combo">
            <span class="kbd">Ctrl</span>
            <span class="kbd">C</span>
          </span>
          Copy password
        </span>
        <span>
          <span class="kbd-combo">
            <span class="kbd">Ctrl</span>
            <span class="kbd">Shift</span>
            <span class="kbd">C</span>
          </span>
          Username
        </span>
      </div>
    </div>
  )
}
