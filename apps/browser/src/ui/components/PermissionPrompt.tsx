import { For, Show, createEffect, on, onCleanup, onMount, type JSX } from 'solid-js'
import {
  PERMISSION_ASKS,
  PERMISSION_NOTES,
  type PermissionDecision,
  type PermissionPrompt,
} from '@ewe/shared'
import { PERMISSION_ICONS } from '../lib/permissions'
import { Icon } from './Icon'
import './Palette.css'
import './Privacy.css'

export const PROMPT_GUARD_MS = 500

export function PermissionPromptCard(props: {
  prompt: PermissionPrompt
  leaving: boolean
  onDecide(decision: PermissionDecision): void
  onFit(height: number): void
}): JSX.Element {
  let host: HTMLDivElement | undefined
  let shownAt = performance.now()
  let moved = false

  createEffect(
    on(
      () => props.prompt,
      () => {
        shownAt = performance.now()
        moved = false
      },
      { defer: true },
    ),
  )

  const act = (decision: PermissionDecision) => {
    if (decision !== 'dismiss' && (!moved || performance.now() - shownAt < PROMPT_GUARD_MS)) return
    props.onDecide(decision)
  }

  onMount(() => {
    const onMove = () => {
      moved = true
    }
    window.addEventListener('pointermove', onMove)
    const report = () => {
      if (host !== undefined) props.onFit(Math.ceil(host.getBoundingClientRect().height))
    }
    const observer = new ResizeObserver(report)
    if (host !== undefined) observer.observe(host)
    report()
    onCleanup(() => {
      window.removeEventListener('pointermove', onMove)
      observer.disconnect()
    })
  })

  const notes = () =>
    props.prompt.kinds.flatMap((kind) => {
      const note = PERMISSION_NOTES[kind]
      return note === undefined ? [] : [note]
    })

  return (
    <div class="perm-host" ref={host}>
      <div
        class="palette perm-prompt"
        classList={{ leaving: props.leaving }}
        role="dialog"
        aria-label={`${props.prompt.host} wants to`}
      >
        <div class="perm-head">
          <span class="perm-title">
            <span class="perm-site">{props.prompt.host}</span> wants to
          </span>
          <button
            class="iconbtn iconbtn--sm perm-close"
            aria-label="Not now"
            title="Not now"
            onClick={() => act('dismiss')}
          >
            <Icon name="x" />
          </button>
        </div>
        <ul class="perm-list">
          <For each={props.prompt.kinds}>
            {(kind) => (
              <li class="perm-row" data-kind={kind}>
                <span class="perm-well">
                  <Icon name={PERMISSION_ICONS[kind]} />
                </span>
                <span>{PERMISSION_ASKS[kind]}</span>
              </li>
            )}
          </For>
        </ul>
        <Show when={notes().length > 0}>
          <For each={notes()}>{(note) => <p class="perm-note">{note}</p>}</For>
        </Show>
        <div class="install-actions">
          <button class="btn btn--ghost btn--sm perm-block" onClick={() => act('block')}>
            Block
          </button>
          <button class="btn btn--primary btn--sm perm-allow" onClick={() => act('allow')}>
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
