import {
  WORKSPACE_COLORS,
  type ShellCommand,
  type TabState,
  type WindowSnapshot,
} from '@ewe/shared'
import type { MenuEntry } from '../components/Menu'
import { api } from '../lib/api'

const send = (command: ShellCommand): void => void api.send(command)

export function tabMenuItems(tab: TabState, snapshot: WindowSnapshot): MenuEntry[] {
  const siblings = snapshot.tabs.filter((t) => t.workspaceId === tab.workspaceId)
  const position = siblings.findIndex((t) => t.id === tab.id)
  const others = siblings.filter((t) => t.id !== tab.id && !t.pinned)
  const right = siblings.slice(position + 1).filter((t) => !t.pinned)
  const current = tab.id === snapshot.activeTabId
  const workspaces: MenuEntry[] = snapshot.workspaces
    .filter((w) => w.id !== tab.workspaceId)
    .map((w) => ({
      type: 'item',
      id: `workspace:${w.id}`,
      label: w.name,
      dot: WORKSPACE_COLORS[w.color],
      run: () => send({ type: 'tab.moveToWorkspace', id: tab.id, workspaceId: w.id }),
    }))
  if (workspaces.length > 0) workspaces.push({ type: 'separator' })
  workspaces.push({
    type: 'item',
    id: 'workspace:new',
    label: 'New workspace',
    icon: 'plus',
    run: () => send({ type: 'tab.moveToWorkspace', id: tab.id }),
  })
  return [
    {
      type: 'item',
      id: 'reload',
      label: 'Reload',
      icon: 'rotate-cw',
      hint: current ? 'Ctrl+R' : undefined,
      run: () => send({ type: 'nav.reload', id: tab.id }),
    },
    {
      type: 'item',
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      run: () => send({ type: 'tab.duplicate', id: tab.id }),
    },
    {
      type: 'item',
      id: 'pin',
      label: tab.pinned ? 'Unpin' : 'Pin',
      icon: tab.pinned ? 'pin-off' : 'pin',
      run: () => send({ type: 'tab.pin', id: tab.id, pinned: !tab.pinned }),
    },
    {
      type: 'item',
      id: 'mute',
      label: tab.muted ? 'Unmute' : 'Mute',
      icon: tab.muted ? 'volume-2' : 'volume-x',
      run: () => send({ type: 'tab.mute', id: tab.id, muted: !tab.muted }),
    },
    { type: 'separator' },
    { type: 'item', id: 'move', label: 'Move to workspace', icon: 'layers', items: workspaces },
    {
      type: 'item',
      id: 'copy-url',
      label: 'Copy link',
      icon: 'link',
      disabled: tab.kind === 'newtab',
      run: () => send({ type: 'tab.copyUrl', id: tab.id }),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'close',
      label: 'Close',
      icon: 'x',
      hint: current ? 'Ctrl+W' : undefined,
      run: () => send({ type: 'tab.close', id: tab.id }),
    },
    {
      type: 'item',
      id: 'close-others',
      label: 'Close others',
      disabled: others.length === 0,
      run: () => send({ type: 'tab.closeOthers', id: tab.id }),
    },
    {
      type: 'item',
      id: 'close-right',
      label: 'Close to the right',
      disabled: right.length === 0,
      run: () => send({ type: 'tab.closeRight', id: tab.id }),
    },
  ]
}
