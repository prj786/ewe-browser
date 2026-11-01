export type Tier = 0 | 1 | 2

export type Where = 'local' | 'read' | 'live' | 'app' | 'store'

export type ArgValue = string | number | boolean | string[]
export type Args = Record<string, ArgValue>

export type PropSchema =
  | {
      type: 'string'
      description: string
      enum?: string[]
      default?: string
    }
  | {
      type: 'integer'
      description: string
      minimum: number
      maximum: number
      default?: number
    }
  | { type: 'boolean'; description: string; default?: boolean }
  | { type: 'array'; description: string; items: { type: 'string' }; minItems: number }

export interface ObjectSchema {
  type: 'object'
  properties: Record<string, PropSchema>
  required: string[]
  additionalProperties: false
}

export interface ToolSpec {
  name: string
  summary: string
  tier: Tier
  where: Where
  usage: string
  schema: ObjectSchema
}

const str = (description: string, extra: { enum?: string[]; default?: string } = {}) =>
  ({ type: 'string', description, ...extra }) satisfies PropSchema
const int = (description: string, minimum: number, maximum: number, value: number) =>
  ({ type: 'integer', description, minimum, maximum, default: value }) satisfies PropSchema
const flag = (description: string) =>
  ({ type: 'boolean', description, default: false }) satisfies PropSchema
const schema = (properties: Record<string, PropSchema> = {}, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false }) satisfies ObjectSchema

const tabId = schema(
  { id: str('Tab id from `tabs` (a unique prefix of at least 4 characters is enough)') },
  ['id'],
)

const workspaceKey = (verb: string) =>
  str(`Workspace to ${verb}: its id, its name (any case) or its number in the bar (1 = first)`)

const downloadId = schema(
  {
    id: str('Download id from `downloads` (a unique prefix of at least 4 characters is enough)'),
  },
  ['id'],
)

export const WORKSPACE_COLOR_NAMES = [
  'ewellow',
  'amber',
  'coral',
  'rose',
  'violet',
  'sky',
  'mint',
  'slate',
]

export const TOOLS: readonly ToolSpec[] = [
  {
    name: 'help',
    summary: 'Usage of every verb, or of one verb with its argument schema',
    tier: 0,
    where: 'local',
    usage: 'ewe-browser help [verb]',
    schema: schema({ verb: str('A verb or tool name') }),
  },
  {
    name: 'commands',
    summary: 'Every tool as {name, summary, tier, schema, argv} for an assistant tool registry',
    tier: 0,
    where: 'local',
    usage: 'ewe-browser commands',
    schema: schema(),
  },
  {
    name: 'version',
    summary: 'The installed ewe browser version',
    tier: 0,
    where: 'local',
    usage: 'ewe-browser version',
    schema: schema(),
  },
  {
    name: 'status',
    summary: 'Whether the browser runs, its windows, tab count and the active tab',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser status',
    schema: schema(),
  },
  {
    name: 'tabs',
    summary:
      'Open tabs of every window with ids, titles, urls and workspaces (the saved session when the browser is closed)',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser tabs',
    schema: schema(),
  },
  {
    name: 'history',
    summary: 'Visited pages, best match first for a query, newest first without one',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser history [query] [--limit N]',
    schema: schema({
      query: str('Words to match in the title, host or url'),
      limit: int('Most results', 1, 1000, 50),
    }),
  },
  {
    name: 'bookmarks',
    summary: 'Bookmarks with their folder path, best match first for a query',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser bookmarks [query] [--limit N]',
    schema: schema({
      query: str('Words to match in the title, host or url'),
      limit: int('Most results', 1, 5000, 100),
    }),
  },
  {
    name: 'downloads',
    summary: 'Downloads, newest first, with their file paths and status',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser downloads [--limit N]',
    schema: schema({ limit: int('Most results', 1, 200, 20) }),
  },
  {
    name: 'recent',
    summary: 'What the home page shows as Recent: documents, videos, music and sites opened lately',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser recent [--kind all|doc|video|audio|web] [--limit N]',
    schema: schema({
      kind: str('Only this kind', {
        enum: ['all', 'doc', 'video', 'audio', 'web'],
        default: 'all',
      }),
      limit: int('Most results', 1, 50, 12),
    }),
  },
  {
    name: 'find',
    summary:
      'Search everything the browser knows: open tabs, bookmarks, history, recent files and the music library',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser find <query> [--limit N]',
    schema: schema(
      {
        query: str('Words to match'),
        limit: int('Most results per group', 1, 50, 8),
      },
      ['query'],
    ),
  },
  {
    name: 'music',
    summary: 'Tracks of the local music library (XDG Music), matching a query when given',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser music [query] [--limit N]',
    schema: schema({
      query: str('Words to match in title, artist, album or genre'),
      limit: int('Most results', 1, 5000, 50),
    }),
  },
  {
    name: 'places',
    summary:
      'The file manager places: home and XDG folders, cloud drives, bookmarks, mounts, trash',
    tier: 0,
    where: 'local',
    usage: 'ewe-browser places',
    schema: schema(),
  },
  {
    name: 'ls',
    summary: 'List a folder: names, kinds, sizes and modification times',
    tier: 0,
    where: 'local',
    usage: 'ewe-browser ls [path] [--hidden] [--sort name|modified|size] [--limit N]',
    schema: schema(
      {
        path: str('Folder to list (absolute, ~ or relative to the working directory)'),
        hidden: flag('Include dot files'),
        sort: str('Order (modified and size put the largest or newest first)', {
          enum: ['name', 'modified', 'size'],
          default: 'name',
        }),
        limit: int('Most entries', 1, 10000, 500),
      },
      ['path'],
    ),
  },
  {
    name: 'locate',
    summary: 'Search file and folder names under a folder (home by default); every word must match',
    tier: 0,
    where: 'local',
    usage: 'ewe-browser locate <query> [--in DIR] [--hidden] [--depth N] [--limit N]',
    schema: schema(
      {
        query: str('Words that must all appear in the name'),
        in: str('Folder to search (default: home)'),
        hidden: flag('Also look inside dot folders'),
        depth: int('Deepest folder level searched', 1, 16, 8),
        limit: int('Most results', 1, 1000, 50),
      },
      ['query'],
    ),
  },
  {
    name: 'page',
    summary:
      "The active tab's url, title and selected text; with text, its visible text too (untrusted content)",
    tier: 0,
    where: 'live',
    usage: 'ewe-browser page [--text] [--max N]',
    schema: schema({
      text: flag("Include the page's visible text"),
      max: int('Most characters of text', 1000, 200000, 20000),
    }),
  },
  {
    name: 'open',
    summary: 'Open urls, folders (in the file manager), files or search text in new tabs',
    tier: 1,
    where: 'app',
    usage:
      'ewe-browser open <url|path|text>... [--new-window] [--background] [--workspace <id|name|number>]',
    schema: schema(
      {
        targets: {
          type: 'array',
          description: 'Urls, absolute paths or text to search for',
          items: { type: 'string' },
          minItems: 1,
        },
        newWindow: flag('Open them in a new window'),
        background: flag('Do not switch to the new tabs'),
        workspace: workspaceKey('open them in'),
      },
      ['targets'],
    ),
  },
  {
    name: 'search',
    summary:
      'Search the web with the search engine chosen in Settings, or search one site (its own results page), in a new tab',
    tier: 1,
    where: 'app',
    usage: 'ewe-browser search <query> [--site <name|host>] [--new-window]',
    schema: schema(
      {
        query: str('What to search for'),
        site: str(
          'Search on this site instead: a name ("zara", "h&m"), a domain ("ss.ge") or a word naming a site you visited ("myauto"); unknown-site when it cannot be found',
        ),
        newWindow: flag('Use a new window'),
      },
      ['query'],
    ),
  },
  {
    name: 'site',
    summary:
      'How a site is searched, without opening anything: its name, host and search url template ({q} = the words), learned from history, OpenSearch, the built-in table or a site: filter',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser site <name|host>',
    schema: schema(
      { site: str('A site name ("zara"), a domain ("ss.ge") or a word naming a visited site') },
      ['site'],
    ),
  },
  {
    name: 'workspaces',
    summary:
      'The workspaces of the focused (else last used) window in bar order: id, name, colour, number, tab count, which is active',
    tier: 0,
    where: 'read',
    usage: 'ewe-browser workspaces',
    schema: schema(),
  },
  {
    name: 'workspace_activate',
    summary: 'Switch to a workspace by id, name or number',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser workspace activate <id|name|number>',
    schema: schema({ workspace: workspaceKey('switch to') }, ['workspace']),
  },
  {
    name: 'workspace_next',
    summary: 'Switch to the next workspace (the last wraps to the first), like Ctrl+Alt+Right',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser workspace next',
    schema: schema(),
  },
  {
    name: 'workspace_prev',
    summary: 'Switch to the previous workspace (the first wraps to the last), like Ctrl+Alt+Left',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser workspace prev',
    schema: schema(),
  },
  {
    name: 'workspace_create',
    summary: 'Create a workspace and switch to it; it opens on Home',
    tier: 1,
    where: 'app',
    usage: 'ewe-browser workspace create [name] [--color c] [--remote <computer>]',
    schema: schema({
      name: str('Name (default "Workspace N", or the computer\'s name with --remote)'),
      color: str('Colour (default the next free one)', { enum: WORKSPACE_COLOR_NAMES }),
      remote: str(
        'Browse from one of your paired computers (its id or name from `ewe-remote status`): the workspace gets its own cookies and its traffic leaves from that computer',
      ),
    }),
  },
  {
    name: 'workspace_rename',
    summary: 'Rename a workspace',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser workspace rename <id|name|number> <new name>',
    schema: schema(
      { workspace: workspaceKey('rename'), name: str('The new name (40 characters at most)') },
      ['workspace', 'name'],
    ),
  },
  {
    name: 'workspace_remove',
    summary:
      'Remove a workspace and close its tabs (web pages can be reopened with tab_reopen); the last workspace cannot be removed',
    tier: 2,
    where: 'live',
    usage: 'ewe-browser workspace remove <id|name|number>',
    schema: schema({ workspace: workspaceKey('remove') }, ['workspace']),
  },
  {
    name: 'back',
    summary: 'Go back in the active tab of the focused (else last used) window',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser back',
    schema: schema(),
  },
  {
    name: 'forward',
    summary: 'Go forward in the active tab of the focused (else last used) window',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser forward',
    schema: schema(),
  },
  {
    name: 'download_open',
    summary: 'Open a finished download with its default app',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser download open <id>',
    schema: downloadId,
  },
  {
    name: 'download_show',
    summary: 'Show a download selected in the file manager',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser download show <id>',
    schema: downloadId,
  },
  {
    name: 'play',
    summary:
      'Play a track from the local music library (best match, or a file path); without a match, search YouTube Music unless local',
    tier: 1,
    where: 'app',
    usage: 'ewe-browser play <query|path> [--local]',
    schema: schema(
      {
        query: str('Title, artist or album words, or an audio file path'),
        local: flag('Never fall back to the web'),
      },
      ['query'],
    ),
  },
  {
    name: 'reveal',
    summary: 'Show a file or folder selected in the file manager',
    tier: 1,
    where: 'app',
    usage: 'ewe-browser reveal <path>',
    schema: schema({ path: str('Absolute path') }, ['path']),
  },
  {
    name: 'home',
    summary: 'Open the home page (search, folders, recent)',
    tier: 1,
    where: 'app',
    usage: 'ewe-browser home',
    schema: schema(),
  },
  {
    name: 'focus',
    summary: 'Bring the browser window forward, starting the browser when it is closed',
    tier: 1,
    where: 'app',
    usage: 'ewe-browser focus',
    schema: schema(),
  },
  {
    name: 'tab_activate',
    summary: 'Switch to a tab (and its workspace and window)',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser tab activate <id>',
    schema: tabId,
  },
  {
    name: 'tab_reload',
    summary: 'Reload a tab',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser tab reload <id>',
    schema: tabId,
  },
  {
    name: 'tab_mute',
    summary: 'Mute a tab',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser tab mute <id>',
    schema: tabId,
  },
  {
    name: 'tab_unmute',
    summary: 'Unmute a tab',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser tab unmute <id>',
    schema: tabId,
  },
  {
    name: 'tab_pin',
    summary: 'Pin a tab',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser tab pin <id>',
    schema: tabId,
  },
  {
    name: 'tab_unpin',
    summary: 'Unpin a tab',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser tab unpin <id>',
    schema: tabId,
  },
  {
    name: 'tab_reopen',
    summary: 'Reopen the most recently closed tab',
    tier: 1,
    where: 'live',
    usage: 'ewe-browser tab reopen',
    schema: schema(),
  },
  {
    name: 'tab_close',
    summary: 'Close a tab (tab_reopen brings it back)',
    tier: 2,
    where: 'live',
    usage: 'ewe-browser tab close <id>',
    schema: tabId,
  },
  {
    name: 'bookmark_add',
    summary: 'Bookmark a url (title defaults to the open tab title or the url)',
    tier: 1,
    where: 'store',
    usage: 'ewe-browser bookmark add <url> [--title T]',
    schema: schema({ url: str('http(s) url'), title: str('Bookmark title') }, ['url']),
  },
  {
    name: 'bookmark_remove',
    summary: 'Remove every bookmark of a url',
    tier: 2,
    where: 'store',
    usage: 'ewe-browser bookmark remove <url>',
    schema: schema({ url: str('Bookmarked url') }, ['url']),
  },
]

export function toolNamed(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name)
}

export type Checked = { ok: true; args: Args } | { ok: false; message: string }

export function checkArgs(spec: ToolSpec, raw: unknown): Checked {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, message: 'arguments must be a JSON object' }
  const input = raw as Record<string, unknown>
  const args: Args = {}
  for (const key of Object.keys(input))
    if (!Object.hasOwn(spec.schema.properties, key))
      return { ok: false, message: `${spec.name} takes no "${key}"` }
  for (const [key, prop] of Object.entries(spec.schema.properties)) {
    const value = input[key]
    if (value === undefined) {
      if (spec.schema.required.includes(key))
        return { ok: false, message: `${spec.name} needs "${key}"` }
      if ('default' in prop && prop.default !== undefined) args[key] = prop.default
      continue
    }
    switch (prop.type) {
      case 'string':
        if (typeof value !== 'string') return { ok: false, message: `"${key}" must be a string` }
        if (prop.enum !== undefined && !prop.enum.includes(value))
          return { ok: false, message: `"${key}" must be one of ${prop.enum.join(', ')}` }
        if (spec.schema.required.includes(key) && value.trim() === '')
          return { ok: false, message: `"${key}" is empty` }
        args[key] = value
        break
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value))
          return { ok: false, message: `"${key}" must be a whole number` }
        if (value < prop.minimum || value > prop.maximum)
          return { ok: false, message: `"${key}" must be ${prop.minimum}–${prop.maximum}` }
        args[key] = value
        break
      case 'boolean':
        if (typeof value !== 'boolean')
          return { ok: false, message: `"${key}" must be true or false` }
        args[key] = value
        break
      case 'array':
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
          return { ok: false, message: `"${key}" must be a list of strings` }
        if (value.length < prop.minItems)
          return { ok: false, message: `"${key}" needs at least ${prop.minItems}` }
        args[key] = value as string[]
        break
    }
  }
  return { ok: true, args }
}
