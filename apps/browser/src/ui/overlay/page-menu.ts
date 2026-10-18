import { createSignal, onCleanup, type Accessor } from 'solid-js'
import { pageMenuItems, type PageMenu, type PageMenuAction } from '@ewe/shared'
import type { IconName } from '../components/Icon'
import type { MenuEntry } from '../components/Menu'
import { api } from '../lib/api'

const ICONS: Partial<Record<PageMenuAction, IconName>> = {
  'link.tab': 'plus',
  'link.workspace': 'layers',
  'link.window': 'app-window',
  'link.save': 'download',
  'link.copy': 'link',
  'media.tab': 'external-link',
  'media.save': 'download',
  'media.copy': 'copy',
  'media.copyUrl': 'link',
  'selection.copy': 'copy',
  'selection.search': 'search',
  'selection.open': 'globe',
  'spell.add': 'book-plus',
  'safe.fill': 'key-round',
  'safe.generate': 'sparkles',
  'edit.undo': 'undo-2',
  'edit.redo': 'redo-2',
  'edit.cut': 'scissors',
  'edit.copy': 'copy',
  'edit.paste': 'clipboard-paste',
  'edit.pastePlain': 'type',
  'edit.selectAll': 'text-select',
  'page.back': 'arrow-left',
  'page.forward': 'arrow-right',
  'page.reload': 'rotate-cw',
  'page.save': 'save',
  'page.print': 'printer',
  'page.source': 'file-code',
  inspect: 'square-mouse-pointer',
}

function iconFor(menu: PageMenu, action: PageMenuAction, on: boolean | undefined): IconName {
  if (on !== undefined) return on ? 'check' : action === 'media.loop' ? 'repeat' : 'eye'
  if (action === 'media.play') return menu.media?.paused === false ? 'pause' : 'play'
  if (action === 'media.mute') return menu.media?.muted === true ? 'volume-2' : 'volume-x'
  if (action === 'page.bookmark') return 'star'
  if (action.startsWith('spell.') && action !== 'spell.add') return 'spell-check'
  return ICONS[action] ?? 'chevron-right'
}

export function pageMenuEntries(menu: PageMenu): MenuEntry[] {
  return pageMenuItems(menu).map((entry): MenuEntry => {
    if (entry.type === 'separator') return entry
    return {
      type: 'item',
      id: entry.action,
      label: entry.label,
      icon: iconFor(menu, entry.action, entry.on),
      hint: entry.hint,
      disabled: entry.disabled,
      run: () =>
        void api.send({ type: 'page.menu.run', menuId: menu.menuId, action: entry.action }),
    }
  })
}

export function createPageMenus(): Accessor<PageMenu | null> {
  const [menu, setMenu] = createSignal<PageMenu | null>(null)
  const off = api.onUi((event) => {
    if (event.type === 'page.menu') setMenu(event.menu)
  })
  onCleanup(off)
  return menu
}
