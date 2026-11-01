import { Show, type JSX } from 'solid-js'
import { Icon } from './Icon'

export function Switch(props: {
  checked: boolean
  label: string
  class?: string | undefined
  disabled?: boolean | undefined
  onChange(next: boolean): void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      class={props.class === undefined ? 'switch' : `switch ${props.class}`}
      classList={{ on: props.checked }}
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled ?? false}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="switch-thumb">
        <Show when={props.checked}>
          <Icon name="check" />
        </Show>
      </span>
    </button>
  )
}
