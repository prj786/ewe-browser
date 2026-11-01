import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'
import type { SafeSheet, SafeSheetAction } from '@ewe/shared'
import { Icon } from '../components/Icon'
import '../components/Palette.css'

const SHEET_GUARD_MS = 500

interface Primary {
  label: string
  action: SafeSheetAction
}

export function PasskeySheet(props: {
  sheet: SafeSheet
  leaving: boolean
  onAction(action: SafeSheetAction, credentialId?: string): void
}): JSX.Element {
  const shownAt = performance.now()
  const [active, setActive] = createSignal(-1)
  let pointerMoved = false
  let keyboardChose = false
  let card: HTMLDivElement | undefined

  const create = () => props.sheet.mode === 'create'
  const title = () =>
    create()
      ? `Save a passkey for ${props.sheet.rpId} in ewe Safe?`
      : `Sign in to ${props.sheet.rpId} with a passkey`

  const settled = () => performance.now() - shownAt >= SHEET_GUARD_MS

  const act = (action: SafeSheetAction, credentialId?: string) => {
    if (action !== 'cancel' && !(settled() && pointerMoved)) return
    props.onAction(action, credentialId)
  }

  const actByKey = (action: SafeSheetAction, credentialId?: string) => {
    if (!(settled() && keyboardChose)) return
    props.onAction(action, credentialId)
  }

  const primary = (): Primary | null => {
    if (props.sheet.state === 'locked') return { label: 'Unlock ewe Safe', action: 'unlock' }
    if (props.sheet.state === 'empty') return null
    return create() ? { label: 'Save', action: 'save' } : { label: 'Sign in', action: 'pick' }
  }

  const runPrimary = (byKey: boolean) => {
    const p = primary()
    if (p === null) return
    const run = byKey ? actByKey : act
    if (p.action === 'pick') {
      const passkey = props.sheet.passkeys[active()]
      if (passkey !== undefined) run('pick', passkey.credentialId)
      return
    }
    run(p.action)
  }

  const onKey = (e: KeyboardEvent) => {
    const count = props.sheet.passkeys.length
    if (e.key === 'Escape') {
      e.preventDefault()
      act('cancel')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runPrimary(true)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
      keyboardChose = true
      if (e.key === 'Tab' || count === 0) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i < 0 ? (step > 0 ? 0 : count - 1) : (i + step + count) % count))
    }
  }

  onMount(() => {
    card?.focus()
    const onMove = () => {
      pointerMoved = true
    }
    window.addEventListener('pointermove', onMove)
    onCleanup(() => window.removeEventListener('pointermove', onMove))
  })

  const account = () => props.sheet.displayName || props.sheet.userName || props.sheet.rpId

  return (
    <div
      ref={card}
      class="palette safe-sheet"
      classList={{ leaving: props.leaving }}
      role="dialog"
      aria-modal="true"
      aria-label={title()}
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <div class="install-head">
        <span class="install-icon safe-sheet-icon">
          <Icon name="fingerprint" size={22} />
        </span>
        <span class="install-text">
          <span class="install-title safe-sheet-title">{title()}</span>
          <span class="install-sub">Safe · {props.sheet.rpId}</span>
        </span>
      </div>
      <Switch>
        <Match when={props.sheet.state === 'locked'}>
          <p class="safe-sheet-note">
            {create()
              ? 'ewe Safe is locked. Unlock it to save the passkey.'
              : 'ewe Safe is locked. Unlock it to use your passkeys.'}
          </p>
        </Match>
        <Match when={props.sheet.state === 'empty'}>
          <p class="safe-sheet-note">There is no passkey for {props.sheet.rpId} in Safe.</p>
        </Match>
        <Match when={create()}>
          <div class="safe-sheet-account">
            <span class="safe-row-icon passkey">
              <Icon name="fingerprint" />
            </span>
            <span class="safe-row-text">
              <span class="safe-row-title">{account()}</span>
              <Show when={props.sheet.userName !== '' && props.sheet.userName !== account()}>
                <span class="safe-row-sub">{props.sheet.userName}</span>
              </Show>
            </span>
          </div>
          <p class="safe-sheet-note">
            <Show when={props.sheet.into} fallback="ewe Safe saves it as a new login.">
              {(into) => <>It goes into your login “{into().title}”.</>}
            </Show>
          </p>
        </Match>
        <Match when={!create()}>
          <div class="safe-sheet-list" role="listbox" aria-label="Passkeys">
            <For each={props.sheet.passkeys}>
              {(passkey, i) => (
                <div
                  class="safe-row"
                  classList={{ active: active() === i() }}
                  role="option"
                  aria-selected={active() === i()}
                  data-row={passkey.credentialId}
                  onMouseEnter={() => setActive(i())}
                  onClick={() => act('pick', passkey.credentialId)}
                >
                  <span class="safe-row-icon passkey">
                    <Icon name="fingerprint" />
                  </span>
                  <span class="safe-row-text">
                    <span class="safe-row-title">{passkey.username || passkey.title}</span>
                    <span class="safe-row-sub">{passkey.title}</span>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <div class="install-actions safe-sheet-actions">
        <button class="btn btn--ghost btn--sm safe-sheet-native" onClick={() => act('native')}>
          <Icon name="usb" />
          Use a security key instead
        </button>
        <span class="safe-sheet-spacer" />
        <button class="btn btn--ghost btn--sm safe-sheet-cancel" onClick={() => act('cancel')}>
          Cancel
        </button>
        <Show when={primary()}>
          {(p) => (
            <button
              class="btn btn--primary btn--sm safe-sheet-primary"
              onClick={() => runPrimary(false)}
            >
              {p().label}
            </button>
          )}
        </Show>
      </div>
    </div>
  )
}
