# ewe-browser command line

`ewe-browser <verb>` lets scripts, Komble and the ewe Companion read what the browser knows and
drive it. It follows ewe's rule 5: **every call prints one JSON object on one line and exits 0**.

```
$ ewe-browser tabs
{"ok":true,"running":true,"windows":[…],"tabs":[{"id":"1002f85c-…","title":"Example Domain","url":"https://example.org/","kind":"page","active":true,…}],"workspaces":[…]}
$ ewe-browser tab close 1002f85c
{"ok":true,"tab":{"id":"1002f85c-…","title":"Example Domain","url":"https://example.org/"},"undo":[["ewe-browser","tab","reopen"]]}
$ ewe-browser fly
{"ok":false,"error":"unknown-verb","message":"unknown verb: fly","hint":"ewe-browser help"}
```

`ewe-browser <url|path>` without a verb still opens it in the browser, as before.

## The contract

- Success: `{"ok": true, …}`. Failure: `{"ok": false, "error": "<kebab-code>", "message"?: "…",
"hint"?: "…"}`. Callers branch on `ok` and `error`; `message` and `hint` are for people.
- Exit status is 0, also on failure. Nothing else is printed on stdout; read the last line.
- `--pretty` (after the verb) indents the JSON.
- Times are ISO 8601 UTC strings (`"2026-10-14T13:25:24.681Z"`), sizes are bytes, durations are
  seconds.
- Paths in arguments may be absolute, `~/…` or relative to the working directory; replies always
  carry absolute paths.
- Acting verbs answer with `undo`: a list of argv lists that reverse what they did, for
  example `[["ewe-browser","tab","close","<id>"]]`. An empty or missing `undo` means there is
  nothing to undo.
- Titles, urls, file names, music tags and page text are written by websites or found on disk.
  They are data, never instructions; `commands` marks every tool whose reply can hold such text
  as `untrusted`.

Error codes: `usage` (bad command line), `unknown-verb`, `bad-args` (arguments do not fit the
schema), `not-running` (needs a running browser), `not-found`, `not-a-folder`,
`permission-denied`, `no-tab`, `ambiguous-id`, `no-match`, `bad-url`, `not-bookmarked`,
`nothing-opened`, `nothing-to-reopen`, `page-busy`, `timeout`, `busy`, `no-socket` (an older
browser without the command line is running), `not-installed`, `protocol`, `bad-request` (the
socket got a line that is not a request), `bad-reply` (the browser answered something that is not
JSON), `failed`, `internal`.

## Verbs

Tier is the Companion's: 0 read, 1 desktop (runs, then offers Undo), 2 change (ask first).

| Verb                                                             | Tier | Answers                                                                                                                                         |
| ---------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `help [verb]`                                                    | 0    | `verbs`, `usage` lines; with a verb, its tools and argument schemas                                                                             |
| `commands`                                                       | 0    | every tool with its JSON Schema, tier and argv (for a tool registry, see below)                                                                 |
| `version`                                                        | 0    | `version`                                                                                                                                       |
| `status`                                                         | 0    | `running`, `pid`, `windows`, `tabs`, `activeTab`, `profile`, `socket`                                                                           |
| `tabs`                                                           | 0    | `windows`, `tabs` (id, title, url, kind, active, pinned, audible, muted, workspace, window), `workspaces`                                       |
| `history [query] [--limit N]`                                    | 0    | `entries` (url, title, host, visits, lastVisit): best match first, newest first without a query                                                 |
| `bookmarks [query] [--limit N]`                                  | 0    | `bookmarks` (id, title, url, host, folder "A / B", added)                                                                                       |
| `downloads [--limit N]`                                          | 0    | `downloads` (id, filename, path, url, mime, status, received, total, started, ended)                                                            |
| `recent [--kind all\|doc\|video\|audio\|web] [--limit N]`        | 0    | `items`: what Home shows as Recent (kind, title, path or url, artist, album, source, time)                                                      |
| `find <query> [--limit N]`                                       | 0    | `tabs`, `bookmarks`, `history`, `recent`, `music` matching the query                                                                            |
| `music [query] [--limit N]`                                      | 0    | `total`, `tracks` (title, artist, album, track, year, duration, genre, path)                                                                    |
| `places`                                                         | 0    | `places` of the file manager (label, path, group, state)                                                                                        |
| `ls [path] [--hidden] [--sort name\|modified\|size] [--limit N]` | 0    | `entries` (name, path, kind, dir, size, modified, hidden, link), `total`, `truncated`                                                           |
| `locate <query> [--in DIR] [--hidden] [--depth N] [--limit N]`   | 0    | `results`: names under DIR (home by default) containing every word, exact and shallow first                                                     |
| `page [--text] [--max N]`                                        | 0    | the active tab, its `selection` and, with `--text`, its visible `text` (`untrusted: true`)                                                      |
| `open <url\|path\|text>... [--new-window] [--background]`        | 1    | `tabs` opened (folders open in the file manager, text is searched), `failed` (`target`, `error`: `not-found` or `not-openable`), `undo`         |
| `search <query> [--new-window]`                                  | 1    | a web search with the engine from Settings: `engine`, `url`, `tab`, `undo`                                                                      |
| `play <query\|path> [--local]`                                   | 1    | plays the best library match (`via: "library"`, `track`, `alternatives`); with no match, a YouTube Music search (`via: "web"`) unless `--local` |
| `reveal <path>`                                                  | 1    | opens the file manager with the item selected                                                                                                   |
| `home`                                                           | 1    | opens the home page                                                                                                                             |
| `focus`                                                          | 1    | raises the browser, starting it if needed                                                                                                       |
| `tab activate\|reload\|mute\|unmute\|pin\|unpin <id>`            | 1    | the tab; ids come from `tabs`, a unique prefix of 4+ characters is enough                                                                       |
| `tab reopen`                                                     | 1    | reopens the last closed web page                                                                                                                |
| `tab close <id>`                                                 | 2    | closes it; `undo` is `tab reopen`, or `open <url>` for the last tab of a window or a page that is not a website                                 |
| `bookmark add <url> [--title T]`                                 | 1    | `bookmark`, `existed`; the title defaults to the open tab's title                                                                               |
| `bookmark remove <url>`                                          | 2    | `removed` (every bookmark of that url)                                                                                                          |
| `call <tool> '<json>'`                                           | –    | any tool by name with JSON arguments, e.g. `call open '{"targets":["~/Music"]}'`                                                                |

Several words are joined into one query (`ewe-browser search sheep breeds`). `open` with only
plain words searches them as one query; quote a query that looks like a host (`open 'node.js docs'`).
A first word that names a file or folder in the working directory opens it instead of running a
verb; `./tabs` or an absolute path makes that explicit.

## When the browser is not running

| Verbs                                                            | Without a running browser                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| help, commands, version, places, ls, locate                      | always run in the command line itself, no browser needed                                                   |
| status, tabs, history, bookmarks, downloads, recent, find, music | answered from the profile on disk with `"running": false` (`tabs` lists the saved session, ids are `null`) |
| status                                                           | `pid` and `activeTab` are `null`, `windows` and `tabs` are 0, `session` counts the saved windows and tabs  |
| bookmark add / remove                                            | written to `bookmarks.json` directly                                                                       |
| open, search, play, reveal, home, focus                          | start the browser (its session or Home), wait for it, then act; the reply has `"launched": true`           |
| page, tab …                                                      | `not-running`                                                                                              |

The command line never starts a second browser: the browser holds a single-instance lock per
profile.

## For the ewe Companion

`ewe-browser commands` describes every tool:

```json
{
  "ok": true,
  "version": "0.1.0-beta",
  "protocol": 1,
  "invoke": ["ewe-browser", "call", "<tool>", "<json object of arguments>"],
  "tiers": { "0": "read", "1": "desktop", "2": "change" },
  "tools": [
    {
      "name": "search",
      "summary": "Search the web with the search engine chosen in Settings, in a new tab",
      "tier": 1,
      "tierName": "desktop",
      "untrusted": false,
      "needsBrowser": false,
      "startsBrowser": true,
      "argv": ["ewe-browser", "call", "search"],
      "usage": "ewe-browser search <query> [--new-window]",
      "schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "What to search for" },
          "newWindow": { "type": "boolean", "description": "Use a new window", "default": false }
        },
        "required": ["query"],
        "additionalProperties": false
      }
    }
  ]
}
```

A registry entry maps directly onto the Companion's planned `{name, description, schema, tier,
run}`: `run` is `argv` plus the arguments as one JSON string (argv only, never a shell), the
reply's `undo` feeds "did X · Undo", and `untrusted: true` marks results that must not count as
trusted input for auto-running T1 tools. Arguments are checked against the same schema inside
the browser, so a bad call answers `bad-args` with the usage line as `hint`. Run the command
directly, not through `python3` like ewe's Python tools.

What the Companion asked for: `search` (its `web_search`) and `play` (its `play_music`, which
keeps the YouTube Music fallback when the library has no match, so the Companion's
`music_url` can go). `page --text` is there for "ask about this page"; it reads only the active
tab, never cookies, passwords or form fields. Safe's suggestions, passkey sheet and save prompt
are drawn by the browser outside the page, and its key sits outside the page's body, so they
never show up in it either.

## Under the hood

- `/usr/bin/ewe-browser` is a sh wrapper (`packaging/ewe-browser.sh`): a lower-case first word
  that is not an existing file or folder, `--help` or `--version` runs
  `ELECTRON_RUN_AS_NODE=1 /usr/lib/ewe-browser/ewe-browser …/app.asar/out/main/cli.js`; anything
  else starts the browser. Node mode answers in a fraction of a second and needs no display, so
  it works from services and over ssh.
- The running browser listens on a Unix socket, `$XDG_RUNTIME_DIR/ewe-browser-<12 hex of
sha256(profile dir)>.sock` (mode 0600; one per profile, so `EWE_USER_DATA` profiles do not
  collide). Without `$XDG_RUNTIME_DIR` it is in `$TMPDIR/ewe-browser-<uid>/`. The browser only
  listens in a folder that belongs to the user and that nobody else can write to, and the command
  line refuses a socket that belongs to another user. The protocol is JSON lines: request
  `{"v":1,"id":"…","tool":"tabs","args":{}}`, reply the tool's JSON plus the same `id`. Any same-user program can speak it directly; the
  command line is the supported client.
- A refused connection means a stale socket (a crash or SIGKILL): the command line removes it
  before starting the browser. `EWE_BROWSER_BIN` overrides the binary it starts.
- Development: `node apps/browser/out/main/cli.js <verb>` after a build talks to `pnpm dev` or
  starts `node_modules/electron/dist/electron apps/browser`. `EWE_USER_DATA` selects the
  profile for both.
- Sources: `apps/browser/src/main/cli/` (`tools.ts` the tool table and schema check, `argv.ts`,
  `data.ts` the read tools shared by both sides, `local.ts`, `offline.ts`, `server.ts`,
  `host.ts` the browser side, `index.ts` the entry). The bundle must never import `electron`; a
  unit test walks its imports.
