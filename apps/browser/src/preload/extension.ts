import { contextBridge } from 'electron'

function alias(): void {
  const scope = globalThis as unknown as { chrome?: object; browser?: object }
  if (scope.chrome === undefined || scope.browser === scope.chrome) return
  Object.defineProperty(globalThis, 'browser', {
    value: scope.chrome,
    configurable: true,
    writable: true,
  })
}

if (process.type === 'service-worker' || location.href.startsWith('chrome-extension://')) {
  try {
    contextBridge.executeInMainWorld({ func: alias })
  } catch {
    alias()
  }
}
