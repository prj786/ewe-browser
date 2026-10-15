import { Show, type JSX } from 'solid-js'
import type { SafePrompt, SafePromptAction } from '@ewe/shared'
import { Icon } from './Icon'
import './Palette.css'

export function SafePromptCard(props: {
  prompt: SafePrompt
  leaving: boolean
  onDecide(action: SafePromptAction): void
}): JSX.Element {
  const update = () => props.prompt.mode === 'update'
  return (
    <div
      class="palette safe-prompt"
      classList={{ leaving: props.leaving }}
      role="dialog"
      aria-label={update() ? 'Update the password in Safe?' : 'Save to Safe?'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onDecide('dismiss')
      }}
    >
      <div class="install-head">
        <span class="install-icon safe-prompt-icon">
          <Icon name="key-round" size={22} />
        </span>
        <span class="install-text">
          <span class="install-title">
            {update() ? 'Update the password in Safe?' : 'Save to Safe?'}
          </span>
          <span class="install-sub">
            <Show when={props.prompt.username !== ''} fallback={props.prompt.host}>
              {props.prompt.username} · {update() ? props.prompt.title : props.prompt.host}
            </Show>
          </span>
        </span>
      </div>
      <div class="install-actions">
        <Show when={!update()}>
          <button
            class="btn btn--ghost btn--sm safe-prompt-never"
            onClick={() => props.onDecide('never')}
          >
            Never for this site
          </button>
        </Show>
        <button
          class="btn btn--ghost btn--sm safe-prompt-later"
          onClick={() => props.onDecide('dismiss')}
        >
          Not now
        </button>
        <button
          class="btn btn--primary btn--sm safe-prompt-save"
          onClick={() => props.onDecide(update() ? 'update' : 'save')}
        >
          {update() ? 'Update' : 'Save'}
        </button>
      </div>
    </div>
  )
}
