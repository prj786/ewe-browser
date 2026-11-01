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

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function HttpsOnly(props: { url: string; error: string }): JSX.Element {
  return (
    <div class="empty https-only" role="alert">
      <span class="empty-icon empty-icon--warning">
        <Icon name="lock-open" />
      </span>
      <h1 class="empty-title">{hostOf(props.url)} has no secure connection</h1>
      <p class="empty-text">
        HTTPS-Only is on, so ewe browser tried https:// first and could not connect securely. Over
        http, others on your network can read and change what you send and see on this site.
      </p>
      <div class="empty-desc">{props.url}</div>
      <Show when={props.error !== ''}>
        <code class="empty-code">{props.error}</code>
      </Show>
      <div class="empty-actions">
        <button class="btn btn--secondary https-back" onClick={() => history.back()}>
          <Icon name="arrow-left" /> Go back
        </button>
        <button
          class="btn btn--ghost https-continue"
          onClick={() => void api.send({ type: 'https.allow', url: props.url })}
        >
          Continue to the http site
        </button>
      </div>
    </div>
  )
}

function Remote(props: { url: string; name: string; message: string }): JSX.Element {
  return (
    <div class="empty remote-error" role="alert">
      <span class="empty-icon empty-icon--warning">
        <Icon name="monitor" />
      </span>
      <h1 class="empty-title">{props.name} can’t be reached</h1>
      <p class="empty-text">
        This workspace browses from {props.name}, so its pages load only through it. Nothing was
        sent from this computer directly.
      </p>
      <Show when={props.message !== ''}>
        <code class="empty-code remote-message">{props.message}</code>
      </Show>
      <Show when={props.url !== ''}>
        <div class="empty-desc">{props.url}</div>
      </Show>
      <div class="empty-actions">
        <Show when={props.url !== ''}>
          <button
            class="btn btn--secondary remote-retry"
            onClick={() => void api.send({ type: 'tab.navigate', input: props.url })}
          >
            <Icon name="rotate-cw" /> Try again
          </button>
        </Show>
        <button class="btn btn--ghost remote-back" onClick={() => history.back()}>
          <Icon name="arrow-left" /> Go back
        </button>
      </div>
    </div>
  )
}

function SadTab(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))
  const params = new URLSearchParams(location.search)
  const url = params.get('url') ?? ''
  const error = params.get('error') ?? ''
  const kind = params.get('kind') ?? ''
  const message = REASONS[error] ?? 'The page could not be loaded.'
  const remote = params.get('name') ?? ''

  const remoteUrl = /^(https?|wss?):\/\//i.test(url) ? url : ''

  return (
    <div class="page">
      <Show
        when={kind === 'remote' && remote !== ''}
        fallback={
          <Show
            when={kind === 'https-only' && /^http:\/\//i.test(url)}
            fallback={
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
            }
          >
            <HttpsOnly url={url} error={error} />
          </Show>
        }
      >
        <Remote url={remoteUrl} name={remote} message={error} />
      </Show>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <SadTab />, root)
