import { Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js'
import type { FindResult, OverlayPart, SwipeDirection } from '@ewe/shared'
import { Icon } from '../components/Icon'
import { api } from '../lib/api'
import './input.css'

interface FindOpen {
  query: string
  seq: number
}

interface SwipeView {
  dir: SwipeDirection
  progress: number
  done: boolean
}

export function findCount(query: string, result: FindResult | null): string {
  if (query === '' || result === null) return ''
  return `${String(result.active)}/${String(result.matches)}`
}

function FindBar(props: {
  open: FindOpen
  result: FindResult | null
  leaving: boolean
}): JSX.Element {
  const [text, setText] = createSignal('')
  let input: HTMLInputElement | undefined

  createEffect(
    on(
      () => props.open.seq,
      () => {
        setText(props.open.query)
        if (input === undefined) return
        input.value = props.open.query
        input.focus()
        input.select()
      },
    ),
  )

  const step = (forward: boolean) => void api.send({ type: 'find.step', forward })
  const none = () => text() !== '' && props.result !== null && props.result.matches === 0

  return (
    <div class="find-bar" classList={{ leaving: props.leaving, none: none() }} role="search">
      <Icon name="search" class="find-glyph" />
      <input
        ref={input}
        class="find-input"
        aria-label="Find in page"
        placeholder="Find in page"
        spellcheck={false}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value)
          void api.send({ type: 'find.query', text: e.currentTarget.value })
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          step(!e.shiftKey)
        }}
      />
      <span class="find-count" aria-live="polite">
        {findCount(text(), props.result)}
      </span>
      <span class="find-divider" />
      <button
        class="iconbtn iconbtn--sm find-prev"
        title="Previous (Shift+Enter)"
        aria-label="Previous match"
        disabled={text() === ''}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => step(false)}
      >
        <Icon name="chevron-up" />
      </button>
      <button
        class="iconbtn iconbtn--sm find-next"
        title="Next (Enter)"
        aria-label="Next match"
        disabled={text() === ''}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => step(true)}
      >
        <Icon name="chevron-down" />
      </button>
      <button
        class="iconbtn iconbtn--sm find-close"
        title="Close (Esc)"
        aria-label="Close find"
        onClick={() => void api.send({ type: 'find.close' })}
      >
        <Icon name="x" />
      </button>
    </div>
  )
}

function SwipeArrow(props: { swipe: SwipeView; leaving: boolean }): JSX.Element {
  return (
    <div
      class="swipe-disc"
      classList={{
        ready: props.swipe.progress >= 1,
        done: props.swipe.done,
        leaving: props.leaving,
      }}
      style={{ '--swipe-progress': String(props.swipe.progress) }}
    >
      <Icon name={props.swipe.dir === 'back' ? 'arrow-left' : 'arrow-right'} size={20} />
    </div>
  )
}

export function InputLayer(props: { part: OverlayPart; leaving: boolean }): JSX.Element {
  const [open, setOpen] = createSignal<FindOpen>({ query: '', seq: 0 })
  const [result, setResult] = createSignal<FindResult | null>(null)
  const [swipe, setSwipe] = createSignal<SwipeView>({ dir: 'back', progress: 0, done: false })

  onMount(() => {
    const off = api.onUi((event) => {
      if (event.type === 'find.open') {
        setResult(null)
        setOpen((o) => ({ query: event.query, seq: o.seq + 1 }))
      } else if (event.type === 'find.result') setResult(event.result)
      else if (event.type === 'swipe')
        setSwipe({ dir: event.dir, progress: event.progress, done: event.done === true })
    })
    onCleanup(off)
  })

  return (
    <>
      <Show when={props.part === 'find'}>
        <div class="find-host">
          <FindBar open={open()} result={result()} leaving={props.leaving} />
        </div>
      </Show>
      <Show when={props.part === 'swipe'}>
        <div
          class="swipe-host"
          classList={{ forward: swipe().dir === 'forward' }}
          onMouseDown={() => void api.send({ type: 'overlay.request', part: 'none' })}
        >
          <SwipeArrow swipe={swipe()} leaving={props.leaving} />
        </div>
      </Show>
    </>
  )
}
