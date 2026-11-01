import { Show, createSignal, onCleanup, onMount, untrack, type JSX } from 'solid-js'
import type { OverlayPart, PermissionPrompt, Point, SiteInfo } from '@ewe/shared'
import { PermissionPromptCard } from '../components/PermissionPrompt'
import { SiteInfoPanel } from '../components/SiteInfo'
import { api } from '../lib/api'

export function PrivacyLayer(props: { part: OverlayPart; leaving: boolean }): JSX.Element {
  const [prompt, setPrompt] = createSignal<PermissionPrompt | null>(null)
  const [site, setSite] = createSignal<{ info: SiteInfo; at: Point } | null>(null)

  const close = () => void api.send({ type: 'overlay.request', part: 'none' })

  onMount(() => {
    const off = api.onUi((event) => {
      switch (event.type) {
        case 'overlay.show':
          if (event.part !== 'permission') setPrompt(null)
          if (event.part !== 'siteinfo') setSite(null)
          break
        case 'permission.prompt':
          setPrompt(event.prompt)
          break
        case 'siteinfo.open':
          setSite({ info: event.info, at: { x: event.x, y: event.y } })
          break
        case 'siteinfo.update': {
          const current = untrack(site)
          if (current !== null && current.info.origin === event.info.origin)
            setSite({ ...current, info: event.info })
          break
        }
        default:
          break
      }
    })
    onCleanup(off)
  })

  return (
    <>
      <Show when={props.part === 'permission' ? prompt() : null}>
        {(p) => (
          <PermissionPromptCard
            prompt={p()}
            leaving={props.leaving}
            onDecide={(decision) =>
              void api.send({ type: 'permission.decide', promptId: p().promptId, decision })
            }
            onFit={(height) =>
              void api.send({ type: 'permission.fit', promptId: p().promptId, height })
            }
          />
        )}
      </Show>
      <Show when={props.part === 'siteinfo' ? site() : null}>
        {(s) => (
          <div
            class="menu-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && close()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <SiteInfoPanel
              info={s().info}
              at={s().at}
              leaving={props.leaving}
              onClose={close}
              onSet={(kind, value) =>
                void api.send({ type: 'permission.set', origin: s().info.origin, kind, value })
              }
              onClear={() => void api.send({ type: 'site.clearData', origin: s().info.origin })}
              onSettings={() => {
                void api.send({ type: 'tab.create', url: 'app://settings/#permissions' })
              }}
            />
          </div>
        )}
      </Show>
    </>
  )
}
