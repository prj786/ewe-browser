import { createServer } from 'node:http'

export interface DavFileEntry {
  body: string
  etag: string
  modified: number
}

export interface DavMock {
  url: string
  folder: string
  files: Map<string, DavFileEntry>
  requests: string[]
  clockOffset: number
  read(name: string): unknown
  write(name: string, value: unknown, modified?: number): void
  close(): Promise<void>
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function davMock(options: { clockOffset?: number } = {}): Promise<DavMock> {
  const files = new Map<string, DavFileEntry>()
  const state = { clockOffset: options.clockOffset ?? 0 }
  const serverNow = () => Date.now() + state.clockOffset
  const requests: string[] = []
  const folder = '/remote.php/dav/files/test/ewe/browser/'
  let n = 0
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
    requests.push(`${req.method ?? ''} ${path}`)
    res.sendDate = false
    res.setHeader('date', new Date(serverNow()).toUTCString())
    if (req.headers.authorization === undefined) {
      res.writeHead(401)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const file = files.get(path)
      if (req.method === 'MKCOL') {
        res.writeHead(201)
      } else if (req.method === 'GET') {
        if (file === undefined) res.writeHead(404)
        else {
          res.writeHead(200, {
            etag: file.etag,
            'content-type': 'application/json',
            'last-modified': new Date(file.modified).toUTCString(),
          })
          res.end(file.body)
          return
        }
      } else if (req.method === 'PUT') {
        const ifMatch = req.headers['if-match']
        const ifNone = req.headers['if-none-match']
        if (
          (ifNone === '*' && file !== undefined) ||
          (ifMatch !== undefined && file?.etag !== ifMatch)
        ) {
          res.writeHead(412)
        } else {
          const etag = `"${++n}"`
          files.set(path, {
            body: Buffer.concat(chunks).toString('utf8'),
            etag,
            modified: serverNow(),
          })
          res.writeHead(file === undefined ? 201 : 204, { etag })
        }
      } else if (req.method === 'DELETE') {
        res.writeHead(file === undefined ? 404 : 204)
        files.delete(path)
      } else if (req.method === 'PROPFIND') {
        const dir = path.endsWith('/') ? path : `${path}/`
        const responses = [`<d:response><d:href>${escapeXml(dir)}</d:href></d:response>`]
        for (const [name, entry] of files) {
          if (!name.startsWith(dir) || name.slice(dir.length).includes('/')) continue
          const href = dir + encodeURIComponent(name.slice(dir.length))
          responses.push(
            `<d:response><d:href>${escapeXml(href)}</d:href><d:propstat><d:prop><d:getetag>${escapeXml(entry.etag)}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          )
        }
        res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' })
        res.end(
          `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${responses.join('')}</d:multistatus>`,
        )
        return
      } else res.writeHead(405)
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}${folder}`,
        folder,
        files,
        requests,
        get clockOffset() {
          return state.clockOffset
        },
        set clockOffset(value: number) {
          state.clockOffset = value
        },
        read: (name) => {
          const file = files.get(`${folder}${name}`)
          return file === undefined ? null : (JSON.parse(file.body) as unknown)
        },
        write: (name, value, modified) => {
          files.set(`${folder}${name}`, {
            body: JSON.stringify(value),
            etag: `"${++n}"`,
            modified: modified ?? serverNow(),
          })
        },
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}
