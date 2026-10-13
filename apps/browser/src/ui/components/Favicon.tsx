import { Show, createEffect, createSignal, on, type JSX } from 'solid-js'
import { Icon } from './Icon'

export function Favicon(props: { src: string | null; size?: number }): JSX.Element {
  const [failed, setFailed] = createSignal(false)
  createEffect(
    on(
      () => props.src,
      () => setFailed(false),
      { defer: true },
    ),
  )
  return (
    <Show when={props.src !== null && !failed()} fallback={<Icon name="globe" size={props.size} />}>
      <img src={props.src ?? ''} alt="" onError={() => setFailed(true)} />
    </Show>
  )
}
