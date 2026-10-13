import { For, Show, createSignal, type JSX } from 'solid-js'
import { extensionIconUrl, type ExtensionInfo, type ExtensionsState } from '@ewe/shared'
import { api } from '../lib/api'

function ExtensionIcon(props: { state: ExtensionsState; info: ExtensionInfo }): JSX.Element {
  const [failed, setFailed] = createSignal(false)
  return (
    <Show
      when={!failed()}
      fallback={<span class="ext-letter">{props.info.name.charAt(0).toUpperCase()}</span>}
    >
      <img
        src={extensionIconUrl(props.state, props.info)}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
      />
    </Show>
  )
}

export function ExtensionActions(props: {
  state: ExtensionsState
  vertical?: boolean
}): JSX.Element {
  const actions = () => props.state.list.filter((e) => e.action !== null)
  const rect = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }
  return (
    <Show when={actions().length > 0}>
      <div class="ext-actions" classList={{ vertical: props.vertical ?? false }}>
        <For each={actions()}>
          {(info) => (
            <button
              class="ext-action"
              title={info.action?.title ?? info.name}
              aria-label={info.action?.title ?? info.name}
              data-extension={info.id}
              tabindex="-1"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) =>
                void api.send({ type: 'extension.activate', id: info.id, ...rect(e.currentTarget) })
              }
              onContextMenu={(e) => {
                e.preventDefault()
                void api.send({
                  type: 'menu.open',
                  menu: { kind: 'extension', id: info.id },
                  x: e.clientX,
                  y: e.clientY,
                })
              }}
            >
              <ExtensionIcon state={props.state} info={info} />
              <Show when={(info.action?.badgeText ?? '') !== ''}>
                <span
                  class="ext-badge"
                  style={
                    info.action?.badgeColor === null || info.action === null
                      ? undefined
                      : { background: info.action.badgeColor }
                  }
                >
                  {info.action?.badgeText}
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
