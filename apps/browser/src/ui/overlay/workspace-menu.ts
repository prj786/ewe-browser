import {
  WORKSPACE_COLORS,
  WORKSPACE_COLOR_ORDER,
  isWorkspaceColor,
  type RemoteChoice,
  type ShellCommand,
  type Workspace,
  type WindowSnapshot,
} from '@ewe/shared'
import type { MenuEntry } from '../components/Menu'
import { api } from '../lib/api'

const send = (command: ShellCommand): void => void api.send(command)

export function newWorkspaceMenuItems(choices: RemoteChoice[]): MenuEntry[] {
  return [
    {
      type: 'item',
      id: 'new',
      label: 'New workspace',
      icon: 'plus',
      run: () => send({ type: 'workspace.create' }),
    },
    { type: 'separator' },
    ...choices.map((c): MenuEntry => ({
      type: 'item',
      id: `remote:${c.id}`,
      label: `Browse from ${c.name}`,
      icon: 'monitor',
      hint: c.usable ? (c.online ? undefined : 'Offline') : 'Not sharing',
      disabled: !c.usable,
      run: () => send({ type: 'workspace.create', remote: c.id }),
    })),
  ]
}

export function workspaceMenuItems(
  workspace: Workspace,
  snapshot: WindowSnapshot,
  rename: () => void,
): MenuEntry[] {
  const others = snapshot.workspaces.filter((w) => w.id !== workspace.id)
  const sources: MenuEntry[] = others.map((w) => {
    const count = snapshot.tabs.filter((t) => t.workspaceId === w.id).length
    return {
      type: 'item',
      id: `merge:${w.id}`,
      label: w.name,
      dot: WORKSPACE_COLORS[w.color],
      hint: String(count),
      disabled: count === 0,
      run: () => send({ type: 'workspace.mergeInto', from: w.id, to: workspace.id }),
    }
  })
  return [
    { type: 'item', id: 'rename', label: 'Rename', icon: 'pencil', run: rename },
    {
      type: 'swatches',
      id: 'color',
      selected: workspace.color,
      swatches: WORKSPACE_COLOR_ORDER.map((color) => ({
        value: color,
        color: WORKSPACE_COLORS[color],
        label: color,
      })),
      pick: (value) => {
        if (isWorkspaceColor(value))
          send({ type: 'workspace.update', id: workspace.id, color: value })
      },
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'move-here',
      label: 'Move tabs here',
      icon: 'layers',
      disabled: others.length === 0,
      items: sources,
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'remove',
      label: 'Remove',
      icon: 'x',
      danger: true,
      disabled: snapshot.workspaces.length <= 1,
      run: () => send({ type: 'workspace.remove', id: workspace.id }),
    },
  ]
}
