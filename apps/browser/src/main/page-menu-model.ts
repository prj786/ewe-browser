import type { ContextMenuParams } from 'electron'
import {
  PAGE_MENU_SUGGESTIONS,
  resolveInput,
  shortText,
  type PageMenu,
  type PageMenuMedia,
  type SafeFieldKind,
  type SearchEngineId,
} from '@ewe/shared'

export type PageMenuParams = Pick<
  ContextMenuParams,
  | 'linkURL'
  | 'linkText'
  | 'srcURL'
  | 'mediaType'
  | 'hasImageContents'
  | 'isEditable'
  | 'selectionText'
  | 'misspelledWord'
  | 'dictionarySuggestions'
  | 'formControlType'
> & {
  editFlags: Pick<
    ContextMenuParams['editFlags'],
    'canUndo' | 'canRedo' | 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll'
  >
  mediaFlags: Pick<
    ContextMenuParams['mediaFlags'],
    'isPaused' | 'isMuted' | 'isLooping' | 'isControlsVisible'
  >
}

export interface PageMenuContext {
  menuId: string
  engine: SearchEngineId
  engineName: string
  pageUrl: string
  canGoBack: boolean
  canGoForward: boolean
  bookmarkable: boolean
  bookmarked: boolean
  safe: SafeFieldKind | null
}

export const SELECTION_MAX = 1000
const LINK_TEXT_MAX = 64
const WEB = /^https?:\/\//i
const SAVABLE = /^(https?|data|blob):/i

export const SAFE_CONTROLS: ReadonlySet<string> = new Set([
  'input-text',
  'input-email',
  'input-password',
  'input-telephone',
  'input-number',
])

export function needsSafeProbe(params: Pick<PageMenuParams, 'isEditable' | 'formControlType'>) {
  return params.isEditable && SAFE_CONTROLS.has(params.formControlType)
}

function mediaOf(params: PageMenuParams): PageMenuMedia | null {
  const kind = params.mediaType
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null
  if (kind === 'image' && params.srcURL === '' && !params.hasImageContents) return null
  return {
    kind,
    url: params.srcURL,
    openable: WEB.test(params.srcURL),
    savable: SAVABLE.test(params.srcURL),
    copyable: kind === 'image' && params.hasImageContents,
    paused: params.mediaFlags.isPaused,
    muted: params.mediaFlags.isMuted,
    loop: params.mediaFlags.isLooping,
    controls: params.mediaFlags.isControlsVisible,
  }
}

export function selectionUrlOf(selection: string, engine: SearchEngineId): string | null {
  if (selection === '' || /\s/.test(selection)) return null
  const resolved = resolveInput(selection, engine)
  return resolved.kind === 'url' && WEB.test(resolved.url) ? resolved.url : null
}

export function buildPageMenu(params: PageMenuParams, ctx: PageMenuContext): PageMenu {
  const selection = params.selectionText.trim().slice(0, SELECTION_MAX)
  const flags = params.editFlags
  return {
    menuId: ctx.menuId,
    engine: ctx.engineName,
    link:
      params.linkURL === ''
        ? null
        : {
            url: params.linkURL,
            text: shortText(params.linkText, LINK_TEXT_MAX),
            openable: WEB.test(params.linkURL),
          },
    media: mediaOf(params),
    selection,
    selectionUrl: selectionUrlOf(selection, ctx.engine),
    edit: params.isEditable
      ? {
          undo: flags.canUndo,
          redo: flags.canRedo,
          cut: flags.canCut,
          copy: flags.canCopy,
          paste: flags.canPaste,
          selectAll: flags.canSelectAll,
          misspelled: params.misspelledWord,
          suggestions: params.dictionarySuggestions.slice(0, PAGE_MENU_SUGGESTIONS),
          safe: ctx.safe,
        }
      : null,
    page: {
      back: ctx.canGoBack,
      forward: ctx.canGoForward,
      bookmarkable: ctx.bookmarkable,
      bookmarked: ctx.bookmarked,
      web: WEB.test(ctx.pageUrl),
    },
  }
}

export function shownUrl(current: string, navigated: string): string {
  return current.startsWith('view-source:') ? current : navigated
}

export const SAVE_NAME_BYTES = 200

export function savePageName(title: string, url: string): string {
  const cleaned = Array.from(title, (c) => (c < ' ' || '/\\:*?"<>|'.includes(c) ? ' ' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  let fallback = 'page'
  try {
    fallback = new URL(url).hostname || fallback
  } catch {
    fallback = 'page'
  }
  const budget = SAVE_NAME_BYTES - Buffer.byteLength('.html')
  let base = ''
  for (const { segment } of new Intl.Segmenter().segment(cleaned === '' ? fallback : cleaned)) {
    if (Buffer.byteLength(base + segment) > budget) break
    base += segment
  }
  return `${base.trimEnd() || fallback.slice(0, 64)}.html`
}
