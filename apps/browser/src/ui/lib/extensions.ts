import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { ExtensionsState } from '@ewe/shared'
import { api } from './api'

const EMPTY: ExtensionsState = { partition: '', tabId: null, list: [] }

export function createExtensions(): Accessor<ExtensionsState> {
  const [state, setState] = createSignal<ExtensionsState>(EMPTY)
  let pushed = false
  const off = api.onExtensions((next) => {
    pushed = true
    setState(next)
  })
  void api.getExtensions().then((next) => {
    if (!pushed) setState(next)
  })
  onCleanup(off)
  return state
}
