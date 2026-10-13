import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import {
  BOOKMARKS_ROOT_ID,
  BOOKMARK_TITLE_MAX,
  emptyBookmarks,
  findBookmarkFolder,
  findBookmarkNode,
  findBookmarkParent,
  flattenBookmarks,
  isBookmarkFolder,
  isBookmarkableUrl,
  sanitizeBookmarks,
  type BookmarkFolder,
  type BookmarkItem,
  type BookmarkNode,
} from '@ewe/shared'
import { debounce, readJson, writeJsonAtomic } from './json-file'

interface BookmarksFile {
  version: 1
  root: BookmarkFolder
}

export function isBookmarksFile(value: unknown): value is BookmarksFile {
  if (typeof value !== 'object' || value === null) return false
  const f = value as Record<string, unknown>
  return f.version === 1 && isBookmarkFolder(f.root) && f.root.id === BOOKMARKS_ROOT_ID
}

export interface BookmarkPatch {
  title?: string | undefined
  url?: string | undefined
  folderId?: string | undefined
  index?: number | undefined
}

function cleanTitle(title: string, fallback: string): string {
  const trimmed = title.trim().slice(0, BOOKMARK_TITLE_MAX)
  return trimmed === '' ? fallback : trimmed
}

export class BookmarksStore extends EventEmitter<{ change: [BookmarkFolder] }> {
  private readonly path: string
  private tree: BookmarkFolder = emptyBookmarks()
  private readonly write = debounce(() => {
    void writeJsonAtomic(this.path, this.toFile())
  }, 500)

  constructor(userData: string) {
    super()
    this.path = join(userData, 'bookmarks.json')
  }

  root(): BookmarkFolder {
    return this.tree
  }

  async load(): Promise<BookmarkFolder> {
    const file = await readJson(this.path, isBookmarksFile)
    if (file !== null) this.tree = sanitizeBookmarks(file.root, randomUUID)
    return this.tree
  }

  find(url: string): BookmarkItem | undefined {
    return flattenBookmarks(this.tree).find((b) => b.item.url === url)?.item
  }

  isBookmarked(url: string): boolean {
    return this.find(url) !== undefined
  }

  add(url: string, title: string, folderId?: string, now = Date.now()): BookmarkItem | undefined {
    if (!isBookmarkableUrl(url)) return undefined
    const folder = this.folderOrRoot(folderId)
    const item: BookmarkItem = {
      id: randomUUID(),
      kind: 'bookmark',
      title: cleanTitle(title, url),
      url,
      added: now,
    }
    folder.children.push(item)
    this.changed()
    return item
  }

  toggle(url: string, title: string): boolean | undefined {
    if (!isBookmarkableUrl(url)) return undefined
    const existing = flattenBookmarks(this.tree).filter((b) => b.item.url === url)
    if (existing.length === 0) return this.add(url, title) !== undefined
    for (const { item } of existing) this.detach(item.id)
    this.changed()
    return false
  }

  remove(id: string): boolean {
    if (id === BOOKMARKS_ROOT_ID || !this.detach(id)) return false
    this.changed()
    return true
  }

  update(id: string, patch: BookmarkPatch): boolean {
    const node = findBookmarkNode(this.tree, id)
    if (node === null || id === BOOKMARKS_ROOT_ID) return false
    if (patch.url !== undefined && node.kind === 'bookmark') {
      const url = patch.url.trim()
      if (!isBookmarkableUrl(url)) return false
      node.url = url
    }
    if (patch.title !== undefined)
      node.title = cleanTitle(patch.title, node.kind === 'bookmark' ? node.url : node.title)
    if (patch.folderId !== undefined || patch.index !== undefined) {
      const target =
        patch.folderId === undefined
          ? findBookmarkParent(this.tree, id)
          : findBookmarkFolder(this.tree, patch.folderId)
      if (target === null || target.id === id || this.isInside(target, id)) return false
      const from = target.children.findIndex((child) => child.id === id)
      this.detach(id)
      let at = patch.index ?? target.children.length
      if (from !== -1 && from < at) at -= 1
      target.children.splice(Math.min(Math.max(0, at), target.children.length), 0, node)
    }
    this.changed()
    return true
  }

  createFolder(title: string, parentId?: string, now = Date.now()): BookmarkFolder {
    const parent = this.folderOrRoot(parentId)
    const folder: BookmarkFolder = {
      id: randomUUID(),
      kind: 'folder',
      title: cleanTitle(title, 'New folder'),
      children: [],
      added: now,
    }
    parent.children.push(folder)
    this.changed()
    return folder
  }

  replace(root: BookmarkFolder): void {
    this.tree = sanitizeBookmarks(root, randomUUID)
    this.changed()
  }

  replaceFolder(folder: BookmarkFolder): void {
    this.tree.children = this.tree.children.filter(
      (child) => !(child.kind === 'folder' && child.title === folder.title),
    )
    this.tree.children.push(folder)
    this.tree = sanitizeBookmarks(this.tree, randomUUID)
    this.changed()
  }

  async flush(): Promise<void> {
    this.write.flush()
    await writeJsonAtomic(this.path, this.toFile())
  }

  private folderOrRoot(id: string | undefined): BookmarkFolder {
    return (id === undefined ? null : findBookmarkFolder(this.tree, id)) ?? this.tree
  }

  private isInside(folder: BookmarkFolder, ancestorId: string): boolean {
    const ancestor = findBookmarkNode(this.tree, ancestorId)
    return ancestor?.kind === 'folder' && findBookmarkNode(ancestor, folder.id) !== null
  }

  private detach(id: string): BookmarkNode | null {
    const parent = findBookmarkParent(this.tree, id)
    if (parent === null) return null
    const index = parent.children.findIndex((child) => child.id === id)
    const [node] = parent.children.splice(index, 1)
    return node ?? null
  }

  private changed(): void {
    this.write()
    this.emit('change', this.tree)
  }

  private toFile(): BookmarksFile {
    return { version: 1, root: this.tree }
  }
}
