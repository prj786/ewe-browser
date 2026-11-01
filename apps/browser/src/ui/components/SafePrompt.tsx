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
  const locked = () => props.prompt.locked && !update()
  const title = () =>
    update() ? 'Update the password in ewe Safe?' : 'Save this login to ewe Safe?'
  const primary = (): SafePromptAction => (update() ? 'update' : locked() ? 'unlock' : 'save')
  return (
    <div
      class="palette safe-prompt"
      classList={{ leaving: props.leaving }}
      role="dialog"
      aria-label={title()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onDecide('dismiss')
      }}
    >
      <div class="install-head">
        <span class="install-icon safe-prompt-icon">
          <Icon name={locked() ? 'lock' : 'key-round'} size={22} />
        </span>
        <span class="install-text">
          <span class="install-title">{title()}</span>
          <span class="install-sub safe-prompt-who">
            <Show when={props.prompt.username !== ''} fallback={props.prompt.host}>
              {props.prompt.username} · {update() ? props.prompt.title : props.prompt.host}
            </Show>
          </span>
          <Show when={locked()}>
            <span class="install-sub safe-prompt-locked">
              ewe Safe is locked. Unlock it to save.
            </span>
          </Show>
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
          onClick={() => props.onDecide(primary())}
        >
          {update() ? 'Update' : locked() ? 'Unlock and save' : 'Save'}
        </button>
      </div>
    </div>
  )
}
