import type { PermissionKind } from '@ewe/shared'
import type { IconName } from '../components/Icon'

export const PERMISSION_ICONS: Record<PermissionKind, IconName> = {
  camera: 'camera',
  microphone: 'mic',
  location: 'map-pin',
  notifications: 'bell',
  clipboard: 'clipboard',
  midi: 'music',
  'local-network': 'network',
  windows: 'monitor',
  idle: 'moon',
}
