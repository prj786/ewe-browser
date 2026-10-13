import { Match, Show, Switch, createEffect, createResource, createSignal, type JSX } from 'solid-js'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { marked } from 'marked'
import { extensionOf, fileKind, type FsEntry } from '@ewe/shared'
import { Icon } from '../../ui/components/Icon'
import { api } from '../../ui/lib/api'

const LANGUAGES = {
  bash,
  c,
  cpp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang)

const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  css: 'css',
  scss: 'scss',
  less: 'scss',
  diff: 'diff',
  patch: 'diff',
  go: 'go',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  toml: 'ini',
  java: 'java',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  qml: 'javascript',
  json: 'json',
  kt: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  markdown: 'markdown',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sql: 'sql',
  swift: 'swift',
  ts: 'typescript',
  tsx: 'typescript',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  svelte: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

const MAX_BYTES = 2 * 1024 * 1024

export function languageFor(name: string): keyof typeof LANGUAGES | null {
  return BY_EXTENSION[extensionOf(name)] ?? null
}

function setHtml(el: HTMLElement, sanitized: string): void {
  el.innerHTML = sanitized
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

export function resolvePath(dir: string, relative: string): string {
  const parts = dir.split('/')
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (parts.length > 1) parts.pop()
    } else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/') || '/'
}

export interface TextViewProps {
  entry: FsEntry
  rawUrl: (path: string) => string
}

export function TextView(props: TextViewProps): JSX.Element {
  const kind = () => fileKind(props.entry)
  const isMarkdown = () => ['md', 'markdown'].includes(extensionOf(props.entry.name))
  const [mode, setMode] = createSignal<'preview' | 'source'>('preview')
  const [text] = createResource(
    () => (kind() === 'pdf' ? null : props.entry.path),
    async (path) => {
      const response = await fetch(props.rawUrl(path), {
        headers: props.entry.size > MAX_BYTES ? { range: `bytes=0-${MAX_BYTES - 1}` } : {},
      })
      if (!response.ok) throw new Error(`Could not read ${props.entry.name}`)
      return response.text()
    },
  )

  const truncated = () => props.entry.size > MAX_BYTES

  const highlighted = () => {
    const body = text() ?? ''
    const language = languageFor(props.entry.name)
    if (language === null || body.length > 400_000) return escapeHtml(body)
    try {
      return hljs.highlight(body, { language, ignoreIllegals: true }).value
    } catch {
      return escapeHtml(body)
    }
  }

  const lineNumbers = () => {
    const count = (text() ?? '').split('\n').length
    return Array.from({ length: count }, (_, i) => i + 1).join('\n')
  }

  const markdownHtml = () => {
    const dir = props.entry.path.slice(0, props.entry.path.lastIndexOf('/')) || '/'
    const html = marked.parse(text() ?? '', { async: false, gfm: true })
    const toRaw = props.rawUrl
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName !== 'IMG') return
      const src = node.getAttribute('src') ?? ''
      if (src !== '' && !/^[a-z]+:/i.test(src))
        node.setAttribute('src', toRaw(resolvePath(dir, decodeURI(src))))
    })
    const clean = DOMPurify.sanitize(html)
    DOMPurify.removeHook('afterSanitizeAttributes')
    return clean
  }

  const onLink = (e: MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (anchor === null) return
    e.preventDefault()
    const href = anchor.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) void api.send({ type: 'tab.create', url: href })
  }

  return (
    <div class="tv" classList={{ pdf: kind() === 'pdf' }}>
      <Switch>
        <Match when={kind() === 'pdf'}>
          <iframe
            class="tv-pdf"
            src={props.rawUrl(props.entry.path)}
            title={props.entry.name}
            onLoad={() => window.focus()}
          />
        </Match>
        <Match when={text.error !== undefined}>
          <div class="tv-message">
            <Icon name="circle-alert" size={24} />
            <span>Could not read {props.entry.name}</span>
          </div>
        </Match>
        <Match when={text.loading}>
          <div class="tv-message">Loading…</div>
        </Match>
        <Match when={text() !== undefined}>
          <Show when={isMarkdown()}>
            <div class="tv-tabs" role="tablist">
              <button
                class="tv-tab"
                classList={{ on: mode() === 'preview' }}
                onClick={() => setMode('preview')}
              >
                Preview
              </button>
              <button
                class="tv-tab"
                classList={{ on: mode() === 'source' }}
                onClick={() => setMode('source')}
              >
                Source
              </button>
            </div>
          </Show>
          <Show
            when={isMarkdown() && mode() === 'preview'}
            fallback={
              <div class="tv-code">
                <pre class="tv-gutter" aria-hidden="true">
                  {lineNumbers()}
                </pre>
                <pre class="tv-source hljs">
                  <code ref={(el) => createEffect(() => setHtml(el, highlighted()))} />
                </pre>
              </div>
            }
          >
            <article
              class="tv-markdown"
              ref={(el) => createEffect(() => setHtml(el, markdownHtml()))}
              onClick={onLink}
            />
          </Show>
          <Show when={truncated()}>
            <div class="tv-note">Showing the first 2 MB.</div>
          </Show>
        </Match>
      </Switch>
    </div>
  )
}
