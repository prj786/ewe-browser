import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@ewe/shared'

export interface PrivacyFlags {
  gpc: boolean
  ask: string[]
}

export interface PrivacyScope {
  Navigator?: { prototype: object }
  Permissions?: { prototype: object }
  Notification?: object
}

export function privacyPage(flags: PrivacyFlags, scope: PrivacyScope = globalThis): void {
  if (flags.gpc && scope.Navigator !== undefined) {
    try {
      Object.defineProperty(scope.Navigator.prototype, 'globalPrivacyControl', {
        get: () => true,
        configurable: true,
        enumerable: true,
      })
    } catch {
      void 0
    }
  }
  const ask = new Set(flags.ask)
  if (ask.size === 0) return
  type Query = (this: unknown, descriptor: unknown) => Promise<{ state: string }>
  const proto = scope.Permissions?.prototype
  const query = proto === undefined ? undefined : (Reflect.get(proto, 'query') as Query | undefined)
  if (proto !== undefined && typeof query === 'function') {
    const patched: Query = function (descriptor) {
      return query.call(this, descriptor).then((status) => {
        const name =
          typeof descriptor === 'object' && descriptor !== null
            ? (descriptor as { name?: unknown }).name
            : undefined
        if (status.state === 'denied' && typeof name === 'string' && ask.has(name))
          Object.defineProperty(status, 'state', { get: () => 'prompt', configurable: true })
        return status
      })
    }
    Reflect.set(proto, 'query', patched)
  }
  const notification = scope.Notification
  if (notification !== undefined && ask.has('notifications')) {
    const own = Object.getOwnPropertyDescriptor(notification, 'permission')
    const read = own?.get === undefined ? undefined : own.get.bind(notification)
    if (read !== undefined)
      Object.defineProperty(notification, 'permission', {
        get() {
          const value: unknown = read()
          return value === 'denied' ? 'default' : value
        },
        configurable: true,
        enumerable: own?.enumerable ?? true,
      })
  }
}

export function installPrivacy(): void {
  let flags: PrivacyFlags
  try {
    flags = ipcRenderer.sendSync(IPC.privacyFrame) as PrivacyFlags
  } catch {
    return
  }
  if (typeof flags !== 'object' || (!flags.gpc && flags.ask.length === 0)) return
  try {
    contextBridge.executeInMainWorld({ func: privacyPage, args: [flags] })
  } catch {
    return
  }
}
