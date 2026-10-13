import type { ExtensionInfo, ShellCommand } from '@ewe/shared'
import type { MenuEntry } from '../components/Menu'
import { api } from '../lib/api'

const send = (command: ShellCommand): void => void api.send(command)

export function extensionMenuItems(info: ExtensionInfo): MenuEntry[] {
  return [
    {
      type: 'item',
      id: 'home',
      label: info.name,
      icon: 'puzzle',
      hint: info.version,
      run: () => send({ type: 'tab.create', url: info.homepageUrl }),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'options',
      label: 'Options',
      icon: 'settings',
      disabled: info.optionsUrl === null,
      run: () => send({ type: 'extension.options', id: info.id }),
    },
    {
      type: 'item',
      id: 'manage',
      label: 'Manage extensions',
      icon: 'external-link',
      run: () => send({ type: 'open.internal', page: 'settings' }),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'remove',
      label: 'Remove from ewe browser',
      icon: 'trash-2',
      danger: true,
      run: () => send({ type: 'extension.remove', id: info.id }),
    },
  ]
}
