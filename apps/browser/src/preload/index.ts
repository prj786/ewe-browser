import { LAYER_ARG } from '@ewe/shared'
import { exposeApi } from './api'
import { installChromeShim, installChromeVersion } from './chrome-shim'
import { installSafe } from './safe/content'

const layer = process.argv.find((arg) => arg.startsWith(LAYER_ARG))?.slice(LAYER_ARG.length)
const topFrame = window === window.top

if (layer === 'shell' || layer === 'overlay' || layer === 'sidebar') exposeApi(layer)
else if (location.protocol === 'app:') {
  if (topFrame) exposeApi('page')
} else if (location.protocol === 'https:' || location.protocol === 'http:') {
  installChromeVersion()
  if (topFrame) installChromeShim()
  installSafe()
}
