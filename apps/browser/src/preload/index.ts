import { LAYER_ARG } from '@ewe/shared'
import { exposeApi } from './api'
import { installChromeShim } from './chrome-shim'

const layer = process.argv.find((arg) => arg.startsWith(LAYER_ARG))?.slice(LAYER_ARG.length)

if (layer === 'shell' || layer === 'overlay' || layer === 'sidebar') exposeApi(layer)
else if (location.protocol === 'app:') exposeApi('page')
else if (location.protocol === 'https:' || location.protocol === 'http:') installChromeShim()
