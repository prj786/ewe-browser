import { For, Show, type JSX } from 'solid-js'
import { Icon } from '../../ui/components/Icon'

export function Row(props: {
  title: JSX.Element
  description?: JSX.Element
  class?: string | undefined
  children?: JSX.Element
}): JSX.Element {
  return (
    <div class={props.class === undefined ? 'row' : `row ${props.class}`}>
      <span class="row-text">
        <span class="row-title">{props.title}</span>
        <Show when={props.description !== undefined}>
          <span class="row-desc">{props.description}</span>
        </Show>
      </span>
      <Show when={props.children !== undefined}>
        <span class="row-trail">{props.children}</span>
      </Show>
    </div>
  )
}

export function Group(props: {
  title?: string | undefined
  class?: string | undefined
  action?: JSX.Element
  children: JSX.Element
}): JSX.Element {
  return (
    <section class="settings-group">
      <Show when={props.title !== undefined || props.action !== undefined}>
        <div class="section-bar">
          <h2 class="section-header">{props.title}</h2>
          {props.action}
        </div>
      </Show>
      <div class={props.class === undefined ? 'list' : `list ${props.class}`}>{props.children}</div>
    </section>
  )
}

export function Divider(): JSX.Element {
  return <div class="list-divider" />
}

export function Select(props: {
  label: string
  class?: string | undefined
  value: string
  options: { value: string; label: string }[]
  onChange(value: string): void
}): JSX.Element {
  return (
    <span class="select">
      <select
        aria-label={props.label}
        class={props.class}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        <For each={props.options}>{(o) => <option value={o.value}>{o.label}</option>}</For>
      </select>
      <Icon name="chevron-down" />
    </span>
  )
}
