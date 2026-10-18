import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import type { JSX } from 'solid-js'
import type { SafeMenu, ShellCommand } from '@ewe/shared'
import { Favicon } from '../components/Favicon'
import { Icon, type IconName } from '../components/Icon'
import { api } from '../lib/api'
import { safeRows, selectable, type SafeRow } from './safe-menu'

const PICK_GUARD_MS = 500

const send = (command: ShellCommand) => void api.send(command)

const iconOf = (row: SafeRow): IconName | null =>
  row.kind === 'action' || row.kind === 'note' ? row.icon : null

const subOf = (row: SafeRow): string =>
  row.kind === 'login' || row.kind === 'passkey' || row.kind === 'card' || row.kind === 'address'
    ? row.sub
    : ''

export function SafeSuggest(props: { menu: SafeMenu; leaving: boolean }): JSX.Element {
  const requestId = untrack(() => props.menu.requestId)
  let placedAt = performance.now()
  let pointerMoved = false
  const [filter, setFilter] = createSignal('')
  const [active, setActive] = createSignal(-1)
  const rows = createMemo(() => safeRows(props.menu, filter()))
  const flat = createMemo(() => [...rows().items, ...rows().footer])
  let list: HTMLDivElement | undefined

  const run = (row: SafeRow) => {
    switch (row.kind) {
      case 'login':
        send({ type: 'safe.choose', requestId, id: row.login.id })
        return
      case 'passkey':
        send({ type: 'safe.passkey', requestId, credentialId: row.passkey.credentialId })
        return
      case 'card':
        send({ type: 'safe.choose', requestId, id: row.card.id })
        return
      case 'address':
        send({ type: 'safe.choose', requestId, id: row.address.id })
        return
      case 'action':
        if (row.action === 'generate') send({ type: 'safe.generate', requestId })
        else if (row.action === 'unlock') send({ type: 'safe.unlock', requestId })
        else send({ type: 'safe.openApp' })
        return
      case 'note':
        return
    }
  }

  const move = (step: number) => {
    const order = flat().flatMap((row, i) => (selectable(row) ? [i] : []))
    if (order.length === 0) return
    const at = order.indexOf(active())
    const next =
      at < 0
        ? step > 0
          ? order[0]
          : order.at(-1)
        : order[(at + step + order.length) % order.length]
    if (next !== undefined) setActive(next)
  }

  const report = () => {
    const height = flat().length === 0 ? 0 : (list?.offsetHeight ?? 0)
    send({ type: 'safe.fit', requestId, height })
  }

  createEffect(() => {
    send({ type: 'safe.selected', requestId, selected: active() >= 0 })
  })

  createEffect(() => {
    flat()
    queueMicrotask(report)
  })

  onMount(() => {
    const off = api.onUi((event) => {
      untrack(() => {
        if (event.type === 'safe.suggest.key' && event.requestId === requestId) {
          if (event.key === 'ArrowDown') move(1)
          else if (event.key === 'ArrowUp') move(-1)
          else if (event.key === 'Enter') {
            const row = flat()[active()]
            if (row !== undefined && selectable(row)) run(row)
            else send({ type: 'safe.close', requestId })
          }
        } else if (event.type === 'safe.suggest.filter' && event.requestId === requestId) {
          setFilter(event.text)
          setActive(-1)
        } else if (event.type === 'safe.suggest.moved' && event.requestId === requestId) {
          placedAt = performance.now()
          pointerMoved = false
        }
      })
    })
    const onMove = () => {
      pointerMoved = true
    }
    window.addEventListener('pointermove', onMove)
    const observer = new ResizeObserver(() => untrack(report))
    if (list !== undefined) observer.observe(list)
    onCleanup(() => {
      off()
      observer.disconnect()
      window.removeEventListener('pointermove', onMove)
    })
  })

  return (
    <div class="safe-suggest-host">
      <div
        ref={list}
        class="safe-suggest"
        classList={{ leaving: props.leaving, empty: flat().length === 0 }}
        role="listbox"
        aria-label="Safe"
      >
        <For each={flat()}>
          {(row, i) => (
            <>
              <Show when={i() > 0 && i() === rows().items.length}>
                <div class="safe-sep" role="separator" />
              </Show>
              <div
                class="safe-row"
                classList={{ active: active() === i(), note: row.kind === 'note' }}
                role="option"
                aria-selected={active() === i()}
                aria-disabled={!selectable(row)}
                data-row={row.key}
                onMouseEnter={() => {
                  if (selectable(row)) setActive(i())
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (e.button !== 0 || !selectable(row)) return
                  if (!pointerMoved || performance.now() - placedAt < PICK_GUARD_MS) return
                  run(row)
                }}
              >
                <span class="safe-row-icon" classList={{ passkey: row.kind === 'passkey' }}>
                  <Switch>
                    <Match when={row.kind === 'login'}>
                      <Favicon src={props.menu.favicon} size={16} />
                    </Match>
                    <Match when={row.kind === 'passkey'}>
                      <Icon name="fingerprint" />
                    </Match>
                    <Match when={row.kind === 'card'}>
                      <Icon name="credit-card" />
                    </Match>
                    <Match when={row.kind === 'address'}>
                      <Icon name="map-pin" />
                    </Match>
                    <Match when={iconOf(row)}>{(name) => <Icon name={name()} />}</Match>
                  </Switch>
                </span>
                <span class="safe-row-text">
                  <span class="safe-row-title">{row.title}</span>
                  <Show when={subOf(row)}>
                    {(sub) => <span class="safe-row-sub">{sub()}</span>}
                  </Show>
                </span>
              </div>
            </>
          )}
        </For>
      </div>
    </div>
  )
}
