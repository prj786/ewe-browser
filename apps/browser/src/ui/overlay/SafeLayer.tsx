import { Show, createSignal, onCleanup, onMount, untrack } from 'solid-js'
import type { JSX } from 'solid-js'
import type {
  OverlayPart,
  SafeMenu,
  SafePrompt,
  SafePromptAction,
  SafeSheet,
  SafeSheetAction,
} from '@ewe/shared'
import { SafePromptCard } from '../components/SafePrompt'
import { api } from '../lib/api'
import { PasskeySheet } from './PasskeySheet'
import { SafeSuggest } from './SafeSuggest'
import './safe.css'

export function SafeLayer(props: { part: OverlayPart; leaving: boolean }): JSX.Element {
  const [suggest, setSuggest] = createSignal<SafeMenu | null>(null)
  const [sheet, setSheet] = createSignal<SafeSheet | null>(null)
  const [prompt, setPrompt] = createSignal<SafePrompt | null>(null)

  const decide = (action: SafePromptAction) => {
    const p = untrack(prompt)
    if (p === null) return
    setPrompt(null)
    void api.send({ type: 'safe.prompt', promptId: p.promptId, action })
  }

  const sheetAction = (s: SafeSheet, action: SafeSheetAction, credentialId?: string) => {
    void api.send({
      type: 'safe.sheet',
      sheetId: s.sheetId,
      action,
      ...(credentialId === undefined ? {} : { credentialId }),
    })
  }

  onMount(() => {
    const off = api.onUi((event) => {
      switch (event.type) {
        case 'overlay.show':
          if (event.part !== 'suggest') setSuggest(null)
          if (event.part !== 'sheet') setSheet(null)
          if (event.part !== 'prompt' && untrack(prompt) !== null) decide('dismiss')
          break
        case 'safe.suggest':
          setSuggest(event.menu)
          break
        case 'safe.sheet':
          setSheet(event.sheet)
          break
        case 'safe.prompt':
          setPrompt(event.prompt)
          break
        default:
          break
      }
    })
    onCleanup(off)
  })

  return (
    <>
      <Show when={props.part === 'suggest' ? suggest() : null} keyed>
        {(menu) => <SafeSuggest menu={menu} leaving={props.leaving} />}
      </Show>
      <Show when={props.part === 'sheet' ? sheet() : null} keyed>
        {(s) => (
          <div
            class="overlay-backdrop safe-sheet-backdrop"
            classList={{ leaving: props.leaving }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) sheetAction(s, 'cancel')
            }}
          >
            <PasskeySheet
              sheet={s}
              leaving={props.leaving}
              onAction={(action, credentialId) => sheetAction(s, action, credentialId)}
            />
          </div>
        )}
      </Show>
      <Show when={props.part === 'prompt' ? prompt() : null}>
        {(p) => (
          <div class="safe-prompt-host">
            <SafePromptCard prompt={p()} leaving={props.leaving} onDecide={decide} />
          </div>
        )}
      </Show>
    </>
  )
}
