import type * as PdfJsModule from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PdfJs = typeof PdfJsModule

let library: Promise<PdfJs> | null = null
const previews = new Map<string, Promise<string | null>>()

function load(): Promise<PdfJs> {
  library ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })
  return library
}

async function render(url: string, width: number): Promise<string | null> {
  const pdfjs = await load()
  const task = pdfjs.getDocument({ url, useWasm: false, disableAutoFetch: true })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (width * window.devicePixelRatio) / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    return canvas.toDataURL('image/png')
  } finally {
    void task.destroy()
  }
}

export function pdfPreview(url: string, key: string, width: number): Promise<string | null> {
  const known = previews.get(key)
  if (known !== undefined) return known
  const job = render(url, width).catch(() => null)
  previews.set(key, job)
  return job
}
