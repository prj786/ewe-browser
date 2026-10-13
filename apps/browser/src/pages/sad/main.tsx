import { Show, createEffect, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import '../../ui/styles/base.css'
import '../pages.css'
import { Icon } from '../../ui/components/Icon'
import { api } from '../../ui/lib/api'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'

const REASONS: Record<string, string> = {
  crashed: 'The page crashed.',
  oom: 'The page ran out of memory.',
  killed: 'The page process was killed.',
  'abnormal-exit': 'The page process exited unexpectedly.',
  'launch-failed': 'The page process could not start.',
}

function SadTab(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))
  const params = new URLSearchParams(location.search)
  const url = params.get('url') ?? ''
  const error = params.get('error') ?? ''
  const message = REASONS[error] ?? 'The page could not be loaded.'

  return (
    <div class="page">
      <div class="empty" role="alert">
        <span class="empty-icon">
          <Icon name="circle-alert" />
        </span>
        <h1 class="empty-title">{message}</h1>
        <Show when={url !== ''}>
          <div class="empty-desc">{url}</div>
        </Show>
        <Show when={error !== '' && REASONS[error] === undefined}>
          <code class="empty-code">{error}</code>
        </Show>
        <Show when={url !== ''}>
          <div class="empty-actions">
            <button
              class="btn btn--secondary"
              onClick={() => void api.send({ type: 'tab.navigate', input: url })}
            >
              <Icon name="rotate-cw" /> Reload
            </button>
          </div>
        </Show>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <SadTab />, root)
