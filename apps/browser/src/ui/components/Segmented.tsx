import { For, type JSX } from 'solid-js'

export interface SegmentedOption {
  value: string
  label: string
}

export function Segmented(props: {
  value: string
  options: SegmentedOption[]
  label: string
  class?: string | undefined
  small?: boolean | undefined
  disabled?: boolean | undefined
  onChange(value: string): void
}): JSX.Element {
  let root: HTMLDivElement | undefined
  const step = (delta: number) => {
    const index = props.options.findIndex((o) => o.value === props.value)
    const next = props.options[(index + delta + props.options.length) % props.options.length]
    if (next === undefined) return
    props.onChange(next.value)
    queueMicrotask(() =>
      root?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus(),
    )
  }
  return (
    <div
      ref={root}
      class={props.class === undefined ? 'seg' : `seg ${props.class}`}
      classList={{ 'seg--sm': props.small ?? false }}
      role="radiogroup"
      aria-label={props.label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1)
        else return
        e.preventDefault()
      }}
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            class="seg-item"
            classList={{ selected: option.value === props.value }}
            aria-checked={option.value === props.value}
            tabindex={option.value === props.value ? 0 : -1}
            data-value={option.value}
            disabled={props.disabled ?? false}
            onClick={() => {
              if (option.value !== props.value) props.onChange(option.value)
            }}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}
