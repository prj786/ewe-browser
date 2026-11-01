import { Show, type JSX } from 'solid-js'
import { Icon, type IconName } from './Icon'

export function EmptyState(props: {
  icon: IconName
  title: string
  children?: JSX.Element
  actions?: JSX.Element
  compact?: boolean | undefined
  warning?: boolean | undefined
  heading?: 'h1' | 'h2' | undefined
  class?: string | undefined
  role?: 'alert' | 'status' | undefined
}): JSX.Element {
  return (
    <div
      class={props.class === undefined ? 'empty' : `empty ${props.class}`}
      classList={{ compact: props.compact ?? false }}
      role={props.role}
    >
      <span class="empty-icon" classList={{ 'empty-icon--warning': props.warning ?? false }}>
        <Icon name={props.icon} />
      </span>
      <Show when={props.heading === 'h1'} fallback={<h2 class="empty-title">{props.title}</h2>}>
        <h1 class="empty-title">{props.title}</h1>
      </Show>
      <Show when={props.children !== undefined}>
        <p class="empty-desc">{props.children}</p>
      </Show>
      <Show when={props.actions !== undefined}>
        <div class="empty-actions">{props.actions}</div>
      </Show>
    </div>
  )
}
