import { Index, Match, Show, Switch, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import { placeMenu, placeSubmenu, type Point, type Rect } from '@ewe/shared'
import { Icon, type IconName } from './Icon'
import './Menu.css'

export interface MenuAction {
  type: 'item'
  id: string
  label: string
  icon?: IconName | undefined
  dot?: string | undefined
  hint?: string | undefined
  danger?: boolean | undefined
  disabled?: boolean | undefined
  items?: MenuEntry[] | undefined
  run?: (() => void) | undefined
}

export interface MenuSeparator {
  type: 'separator'
}

export interface MenuSwatch {
  value: string
  color: string
  label: string
}

export interface MenuSwatches {
  type: 'swatches'
  id: string
  swatches: MenuSwatch[]
  selected?: string | undefined
  pick(value: string): void
}

export type MenuEntry = MenuAction | MenuSeparator | MenuSwatches

export interface MenuProps {
  items: MenuEntry[]
  at: Point
  leaving?: boolean | undefined
  onClose: () => void
}

type Anchor = { kind: 'point'; at: Point } | { kind: 'row'; row: Rect }

interface PanelProps {
  items: MenuEntry[]
  anchor: Anchor
  focus: boolean
  selectFirst: boolean
  leaving: boolean
  onClose: () => void
  onBack?: (() => void) | undefined
}

interface OpenSubmenu {
  index: number
  row: Rect
  keyboard: boolean
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

const asItem = (entry: MenuEntry): MenuAction | null => (entry.type === 'item' ? entry : null)
const asSwatches = (entry: MenuEntry): MenuSwatches | null =>
  entry.type === 'swatches' ? entry : null

function MenuPanel(props: PanelProps): JSX.Element {
  const [pos, setPos] = createSignal<Point>({ x: 0, y: 0 })
  const [active, setActive] = createSignal(-1)
  const [swatch, setSwatch] = createSignal(0)
  const [sub, setSub] = createSignal<OpenSubmenu | null>(null)
  let panel: HTMLDivElement | undefined

  const entryAt = (i: number): MenuEntry | undefined => props.items[i]
  const selectable = (i: number): boolean => {
    const entry = entryAt(i)
    if (entry === undefined || entry.type === 'separator') return false
    return !(entry.type === 'item' && entry.disabled === true)
  }

  const closeSub = () => {
    if (sub() === null) return
    setSub(null)
    panel?.focus()
  }

  const openSub = (i: number, keyboard: boolean) => {
    const row = panel?.querySelector(`[data-index="${i}"]`)
    if (row === undefined || row === null) return
    setSub({ index: i, row: rectOf(row), keyboard })
  }

  const point = (i: number) => {
    setActive(i)
    const entry = entryAt(i)
    if (entry?.type === 'swatches') {
      const found = entry.swatches.findIndex((s) => s.value === entry.selected)
      setSwatch(Math.max(0, found))
    }
  }

  const hover = (i: number) => {
    if (!selectable(i)) {
      setActive(-1)
      closeSub()
      return
    }
    point(i)
    const entry = entryAt(i)
    if (entry?.type === 'item' && entry.items !== undefined) {
      if (sub()?.index !== i) openSub(i, false)
    } else closeSub()
  }

  const move = (delta: number) => {
    const n = props.items.length
    if (n === 0) return
    let i = active() === -1 ? (delta > 0 ? -1 : n) : active()
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n
      if (selectable(i)) {
        point(i)
        closeSub()
        return
      }
    }
  }

  const select = (i: number) => {
    const entry = entryAt(i)
    if (entry === undefined || !selectable(i)) return
    if (entry.type === 'item') {
      if (entry.items !== undefined) {
        point(i)
        openSub(i, true)
        return
      }
      entry.run?.()
      props.onClose()
    } else if (entry.type === 'swatches') {
      const chosen = entry.swatches[swatch()]
      if (chosen === undefined) return
      entry.pick(chosen.value)
      props.onClose()
    }
  }

  const onKey = (e: KeyboardEvent) => {
    const entry = entryAt(active())
    switch (e.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'ArrowRight':
        if (entry?.type === 'swatches') setSwatch((s) => Math.min(s + 1, entry.swatches.length - 1))
        else if (entry?.type === 'item' && entry.items !== undefined) openSub(active(), true)
        else return
        break
      case 'ArrowLeft':
        if (entry?.type === 'swatches' && swatch() > 0) setSwatch((s) => s - 1)
        else if (props.onBack !== undefined) props.onBack()
        else return
        break
      case 'Enter':
      case ' ':
        select(active())
        break
      case 'Escape':
        props.onClose()
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const place = () => {
    if (panel === undefined) return
    const size = { width: panel.offsetWidth, height: panel.offsetHeight }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const anchor = props.anchor
    setPos(
      anchor.kind === 'point'
        ? placeMenu(anchor.at, size, viewport)
        : placeSubmenu(anchor.row, size, viewport),
    )
  }

  onMount(() => {
    if (panel === undefined) return
    place()
    window.addEventListener('resize', place)
    onCleanup(() => window.removeEventListener('resize', place))
    if (props.focus) panel.focus()
    if (props.selectFirst) move(1)
  })

  return (
    <>
      <div
        ref={panel}
        class="menu"
        classList={{ leaving: props.leaving, submenu: props.anchor.kind === 'row' }}
        role="menu"
        tabindex="-1"
        style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
        onKeyDown={onKey}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Index each={props.items}>
          {(entry, i) => (
            <Switch>
              <Match when={entry().type === 'separator'}>
                <div class="menu-separator" role="separator" />
              </Match>
              <Match when={asItem(entry())}>
                {(item) => (
                  <div
                    class="menu-item"
                    classList={{
                      active: active() === i,
                      disabled: item().disabled === true,
                      danger: item().danger === true,
                    }}
                    role="menuitem"
                    aria-disabled={item().disabled === true}
                    aria-haspopup={item().items !== undefined}
                    data-index={i}
                    onMouseEnter={() => hover(i)}
                    onClick={() => select(i)}
                  >
                    <span class="menu-slot">
                      <Show when={item().dot}>
                        {(dot) => <span class="menu-dot" style={{ '--menu-dot': dot() }} />}
                      </Show>
                      <Show when={item().icon}>{(icon) => <Icon name={icon()} />}</Show>
                    </span>
                    <span class="menu-label">{item().label}</span>
                    <Show when={item().hint}>
                      {(hint) => <span class="menu-hint">{hint()}</span>}
                    </Show>
                    <Show when={item().items !== undefined}>
                      <Icon name="chevron-right" class="menu-chevron" size={14} />
                    </Show>
                  </div>
                )}
              </Match>
              <Match when={asSwatches(entry())}>
                {(row) => (
                  <div
                    class="menu-swatches"
                    classList={{ active: active() === i }}
                    role="group"
                    data-index={i}
                    onMouseEnter={() => hover(i)}
                  >
                    <Index each={row().swatches}>
                      {(s, j) => (
                        <button
                          class="menu-swatch"
                          classList={{
                            selected: row().selected === s().value,
                            focused: active() === i && swatch() === j,
                          }}
                          style={{ '--swatch': s().color }}
                          aria-label={s().label}
                          title={s().label}
                          data-value={s().value}
                          aria-pressed={row().selected === s().value}
                          tabindex="-1"
                          onMouseEnter={() => setSwatch(j)}
                          onClick={(e) => {
                            e.stopPropagation()
                            row().pick(s().value)
                            props.onClose()
                          }}
                        />
                      )}
                    </Index>
                  </div>
                )}
              </Match>
            </Switch>
          )}
        </Index>
      </div>
      <Show when={sub()}>
        {(open) => {
          const items = (): MenuEntry[] => {
            const entry = entryAt(open().index)
            return entry?.type === 'item' ? (entry.items ?? []) : []
          }
          return (
            <MenuPanel
              items={items()}
              anchor={{ kind: 'row', row: open().row }}
              focus={open().keyboard}
              selectFirst={open().keyboard}
              leaving={props.leaving}
              onClose={props.onClose}
              onBack={closeSub}
            />
          )
        }}
      </Show>
    </>
  )
}

export function Menu(props: MenuProps): JSX.Element {
  onMount(() => {
    const onBlur = () => props.onClose()
    window.addEventListener('blur', onBlur)
    onCleanup(() => window.removeEventListener('blur', onBlur))
  })
  return (
    <MenuPanel
      items={props.items}
      anchor={{ kind: 'point', at: props.at }}
      focus
      selectFirst={false}
      leaving={props.leaving ?? false}
      onClose={props.onClose}
    />
  )
}
