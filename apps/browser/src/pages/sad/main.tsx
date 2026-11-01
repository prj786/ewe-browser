import { Show, createEffect, createSignal, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import '../../ui/styles/base.css'
import '../pages.css'
import { EmptyState } from '../../ui/components/EmptyState'
import { Icon, type IconName } from '../../ui/components/Icon'
import { api } from '../../ui/lib/api'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'

interface Explained {
  icon: IconName
  title: string
  text: string
  search?: boolean
}

const CRASHES: Record<string, Explained> = {
  crashed: { icon: 'circle-alert', title: 'This page crashed', text: 'Reload it to try again.' },
  oom: {
    icon: 'circle-alert',
    title: 'This page ran out of memory',
    text: 'Close a few tabs, then reload it.',
  },
  killed: { icon: 'circle-alert', title: 'This page was stopped', text: 'Reload it to try again.' },
  'abnormal-exit': {
    icon: 'circle-alert',
    title: 'This page stopped unexpectedly',
    text: 'Reload it to try again.',
  },
  'launch-failed': {
    icon: 'circle-alert',
    title: 'This page couldn’t start',
    text: 'Reload it to try again.',
  },
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function explain(error: string, url: string): Explained {
  const crash = CRASHES[error]
  if (crash !== undefined) return crash
  const host = url === '' ? 'the site' : hostOf(url)
  const code = error.replace(/^net::/, '')
  if (/^ERR_(NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED)$/.test(code))
    return {
      icon: 'search',
      title: `Can’t find ${host}`,
      text: 'Check the address for typos, or search for it instead.',
      search: true,
    }
  if (/^ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|NETWORK_IO_SUSPENDED)$/.test(code))
    return {
      icon: 'network',
      title: 'You’re offline',
      text: 'Check your Wi-Fi or cable, then try again.',
    }
  if (code === 'ERR_CONNECTION_REFUSED')
    return {
      icon: 'circle-alert',
      title: `${host} refused to connect`,
      text: 'The site may be down, or it doesn’t take connections here.',
    }
  if (/^ERR_(CONNECTION_TIMED_OUT|TIMED_OUT)$/.test(code))
    return {
      icon: 'circle-alert',
      title: `${host} took too long to answer`,
      text: 'It may be busy or down. Try again in a moment.',
    }
  if (/^ERR_(CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|EMPTY_RESPONSE)$/.test(code))
    return {
      icon: 'circle-alert',
      title: `The connection to ${host} was cut`,
      text: 'Try again in a moment.',
    }
  if (/^ERR_(ADDRESS_UNREACHABLE|ADDRESS_INVALID)$/.test(code))
    return {
      icon: 'network',
      title: `Can’t reach ${host}`,
      text: 'Your network has no way to that address.',
    }
  if (/^ERR_(SSL_|CERT_)/.test(code))
    return {
      icon: 'lock-open',
      title: `Can’t connect securely to ${host}`,
      text: 'Its secure connection didn’t check out, so nothing was sent.',
    }
  if (code === 'ERR_TOO_MANY_REDIRECTS')
    return {
      icon: 'circle-alert',
      title: `${host} keeps redirecting`,
      text: 'Clearing the site’s cookies may help.',
    }
  if (/^ERR_BLOCKED_BY_(CLIENT|RESPONSE|ADMINISTRATOR)$/.test(code))
    return {
      icon: 'circle-alert',
      title: `${host} can’t be shown here`,
      text: 'The site doesn’t allow it to open this way.',
    }
  if (code === 'ERR_FILE_NOT_FOUND')
    return {
      icon: 'file',
      title: 'File not found',
      text: 'It may have been moved or deleted.',
    }
  if (/^ERR_(PROXY|TUNNEL|SOCKS)/.test(code))
    return {
      icon: 'network',
      title: `Can’t reach ${host}`,
      text: 'The connection it goes through isn’t answering.',
    }
  return {
    icon: 'circle-alert',
    title: `Can’t open ${host}`,
    text: 'Something went wrong while loading it.',
  }
}

function Details(props: { url: string; code: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false)
  return (
    <Show when={props.url !== '' || props.code !== ''}>
      <details class="sad-details">
        <summary>Details</summary>
        <div class="sad-details-body">
          <Show when={props.url !== ''}>
            <div class="sad-link">
              <span class="sad-url" title={props.url}>
                {props.url}
              </span>
              <button
                class="btn btn--ghost btn--sm sad-copy"
                onClick={() =>
                  void navigator.clipboard.writeText(props.url).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }
              >
                <Icon name={copied() ? 'check' : 'link'} />
                {copied() ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </Show>
          <Show when={props.code !== ''}>
            <code class="empty-code">{props.code}</code>
          </Show>
        </div>
      </details>
    </Show>
  )
}

function GoBack(props: { class?: string; primary?: boolean }): JSX.Element {
  return (
    <button
      class={`btn ${props.primary === true ? 'btn--primary' : 'btn--secondary'} ${props.class ?? ''}`}
      onClick={() => history.back()}
    >
      <Icon name="arrow-left" /> Go back
    </button>
  )
}

function HttpsOnly(props: { url: string; error: string }): JSX.Element {
  return (
    <>
      <EmptyState
        warning
        heading="h1"
        role="alert"
        icon="lock-open"
        class="https-only"
        title={`${hostOf(props.url)} has no secure connection`}
        actions={
          <>
            <GoBack primary class="https-back" />
            <button
              class="btn btn--ghost https-continue"
              onClick={() => void api.send({ type: 'https.allow', url: props.url })}
            >
              Continue to the http site
            </button>
          </>
        }
      >
        HTTPS-Only is on, and this site has no https:// version. Over http, others on your network
        can read and change what you send and see.
      </EmptyState>
      <Details url={props.url} code={props.error} />
    </>
  )
}

function Remote(props: { url: string; name: string; message: string }): JSX.Element {
  const human = () => props.message !== '' && !/^(net::)?ERR_[A-Z_]+$/.test(props.message)
  return (
    <>
      <EmptyState
        warning
        heading="h1"
        role="alert"
        icon="monitor"
        class="remote-error"
        title={`${props.name} can’t be reached`}
        actions={
          <>
            <Show when={props.url !== ''}>
              <button
                class="btn btn--primary remote-retry"
                onClick={() => void api.send({ type: 'tab.navigate', input: props.url })}
              >
                <Icon name="rotate-cw" /> Try again
              </button>
            </Show>
            <GoBack class="remote-back" />
          </>
        }
      >
        This workspace browses from {props.name}, so its pages load only through it. Nothing was
        sent from this computer directly.
        <Show when={human()}>
          <span class="remote-message">{props.message}</span>
        </Show>
      </EmptyState>
      <Details url={props.url} code={human() ? '' : props.message} />
    </>
  )
}

function Failed(props: { url: string; error: string }): JSX.Element {
  const info = () => explain(props.error, props.url)
  const crash = () => CRASHES[props.error] !== undefined
  return (
    <>
      <EmptyState
        heading="h1"
        role="alert"
        icon={info().icon}
        title={info().title}
        actions={
          <>
            <Show when={props.url !== ''}>
              <button
                class="btn btn--primary sad-retry"
                onClick={() => void api.send({ type: 'tab.navigate', input: props.url })}
              >
                <Icon name="rotate-cw" /> {crash() ? 'Reload' : 'Try again'}
              </button>
            </Show>
            <Show when={info().search === true && props.url !== ''}>
              <button
                class="btn btn--secondary sad-search"
                onClick={() =>
                  void api.send({ type: 'tab.navigate', input: `w: ${hostOf(props.url)}` })
                }
              >
                <Icon name="search" /> Search instead
              </button>
            </Show>
            <Show when={history.length > 1 && info().search !== true}>
              <GoBack class="sad-back" />
            </Show>
          </>
        }
      >
        {info().text}
      </EmptyState>
      <Details url={props.url} code={crash() ? '' : props.error} />
    </>
  )
}

function SadTab(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))
  const params = new URLSearchParams(location.search)
  const url = params.get('url') ?? ''
  const error = params.get('error') ?? ''
  const kind = params.get('kind') ?? ''
  const remote = params.get('name') ?? ''
  const remoteUrl = /^(https?|wss?):\/\//i.test(url) ? url : ''
  document.title =
    kind === 'remote' && remote !== ''
      ? `${remote} can’t be reached`
      : kind === 'https-only'
        ? `${hostOf(url)} has no secure connection`
        : explain(error, url).title

  return (
    <div class="page page-sad">
      <div class="sad">
        <Show
          when={kind === 'remote' && remote !== ''}
          fallback={
            <Show
              when={kind === 'https-only' && /^http:\/\//i.test(url)}
              fallback={<Failed url={url} error={error} />}
            >
              <HttpsOnly url={url} error={error} />
            </Show>
          }
        >
          <Remote url={remoteUrl} name={remote} message={error} />
        </Show>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <SadTab />, root)
