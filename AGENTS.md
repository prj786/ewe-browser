# ewe browser — map for agents

This file is the entry point for any agent or AI working in this repository. It describes what
exists, how the pieces talk to each other, how to verify a change, and which traps have already
been hit. `docs/PLAN.md` holds the roadmap and open bugs; `docs/DESIGN.md` holds the visual spec.

## What this is

A Chromium-engine browser built on Electron 44 (Chromium 152, Node 24) for the owner's "ewe"
Linux desktop (Hyprland, Wayland). The main process owns every tab as a `WebContentsView`. The
visible chrome is a thin Solid UI in three renderer layers (the base shell with the left tab rail,
a transparent overlay and a full-height right sidebar) plus six internal pages served on `app://` (newtab, home, settings, sad, files, music). Styling follows the owner's Ewe design system v3.
Phases 0–2 and the history part of phase 4 are implemented and verified; nothing has been
committed yet, and the first commit waits for the owner's review of the staged diff.

## Commands

The `pnpm` on this machine's PATH is a broken mise shim. Always run pnpm through npx:

```
npx -y pnpm@11.13.0 install
npx -y pnpm@11.13.0 dev            # electron-vite: HMR for renderers, restart for main
npx -y pnpm@11.13.0 build          # out/main, out/preload, out/renderer
npx -y pnpm@11.13.0 typecheck      # tsc for shared, main (node) and renderers (web)
npx -y pnpm@11.13.0 lint           # eslint 10, typescript-eslint strict
npx -y pnpm@11.13.0 exec prettier --write <files>
npx -y pnpm@11.13.0 test           # vitest: packages/shared/src/*.test.ts + apps/browser/tests/unit
npx -y pnpm@11.13.0 test:e2e       # playwright _electron, needs a prior build
cd apps/browser && node scripts/visual.mjs ../../docs/screenshots   # screenshots, needs a build
npx -y pnpm@11.13.0 package        # build + electron-builder → apps/browser/dist/linux-unpacked
makepkg -d --skipchecksums         # the Arch package (see Packaging), from a source tarball
```

Run the whole loop after any change: typecheck, lint, unit tests, build, e2e, screenshots, then
look at the screenshots. Electron must run on the real Wayland session (headless crashes).
`EWE_USER_DATA=<dir>` points the app at a throwaway profile; the single-instance lock is per
profile. `EWE_DOWNLOADS=<dir>` replaces `~/Downloads` (tests and screenshots use it), and
`XDG_CONFIG_HOME` moves the ewe theme and account files (the theme e2e test uses it). The user-data default is `~/.config/ewe-browser`. Never clean `~/.config/ewe`, that
directory belongs to the ewe desktop itself.

## Repository layout

```
package.json                      pnpm workspace scripts (dev, build, typecheck, lint, test, test:e2e, package)
pnpm-workspace.yaml               packages + allowBuilds (electron, esbuild)
PKGBUILD                          the Arch package (Komble pattern: _tag/pkgver rewritten by release.yml)
packaging/                        ewe-browser.desktop, ewe-browser.svg (the app icon), icons/*.png
scripts/gen-icons.sh              rsvg-convert the SVG into packaging/icons/{32..512}x*.png (committed)
.github/workflows/                release.yml (tag → makepkg → GitHub release), ci.yml (static checks, unit tests)
packages/shared/src/
  models.ts                       TabState, WindowSnapshot, Settings, Session*, ThemeTokens, Workspace, Account,
                                  constants (RAIL_WIDTH 264, RAIL_COLLAPSED_WIDTH 56, PAGE_GAP 8,
                                  EDGE_ZONE 12, EDGE_LEAVE_ZONE 24, EDGE_EXIT_ZONE 160, NEW_TAB_URL, …)
  ipc-contract.ts                 ShellCommand, UiEvent, BrowserApi, IPC channel names, runtime validators
  url.ts                          resolveInput (t:/w: prefixes, url vs search), displayUrl, hostOf, SEARCH_ENGINES
  workspaces.ts                   WORKSPACE_COLORS, nextWorkspaceColor, defaultWorkspaceName
  shortcuts.ts                    SHORTCUT_IDS, DEFAULT_SHORTCUTS, parseChord/formatChord/chordFromInput,
                                  sanitizeShortcuts, buildKeymap/matchKeymap, shortcutConflicts
  text.ts                         middleEllipsis() — grapheme-aware "random wor…ame"
  menu.ts                         placeMenu() / placeSubmenu(prefer side) / placeAbove() — menu and popover placement
  files.ts                        FsEntry/FsListing/FsPlace, FsRequest + isFsRequest, filesUrl/pathFromFilesUrl,
                                  isLocalPathInput, fileKind, sortEntries/filterEntries, gvfsLabel
  music.ts                        Track/Album/Artist, MusicRequest, groupAlbums/groupArtists, searchTracks,
                                  compareTracks, shuffled, formatDuration
  bookmarks.ts                    BookmarkItem/BookmarkFolder tree, isBookmarkableUrl, find*/flatten/count,
                                  rankBookmarks (palette), isBookmarkNode validator, sanitizeBookmarks
  home.ts                         RecentItem/RecentKind/RecentFilter, HomeRequest + isHomeRequest,
                                  recentKindOf, isSearchResultUrl, dedupeRecents, pickRecents
apps/browser/
  electron.vite.config.ts         main/preload/renderer builds, seven HTML inputs, devCsp plugin, @ewe/shared alias
  electron-builder.yml            dir target, castlabs runtime from node_modules/electron/dist, app.asar
  src/main/index.ts               bootstrap: app name, EWE_USER_DATA, single instance, app:// scheme, stores, windows
  src/main/window-manager.ts      WindowController (one BrowserWindow + overlay + TabManager), WindowManager
  src/main/tab-manager.ts         tabs, workspaces, navigation, per-tab event wiring, popups, shortcuts, mouse hooks
  src/main/overlay.ts             OverlayController: the transparent WebContentsView above the pages
  src/main/layout.ts              rect math: pageBounds, overlayBounds, hoverZone (left edge), sidebarBounds
  src/main/shortcuts.ts           matchShortcut(): keymap from settings (setShortcuts) → ShortcutAction
  src/main/ipc.ts                 ipcMain handlers, sender-frame checks, per-layer command policy
  src/main/protocol.ts            app:// scheme (prod from out/renderer with CSP, dev proxied to Vite)
  src/main/identity.ts            user agent cleanup and window.chrome shim injection
  src/main/ewe-theme.ts           reads/watches ~/.config/quickshell/theme-tokens.json (v3): colours, shadows,
                                  shape, size, fonts, motion, text scale
  src/main/sidebar.ts             SidebarController: the lazily created right sidebar WebContentsView
  src/main/downloads.ts           DownloadManager: will-download on persist:default, save path, pause/resume/cancel,
                                  retry, open, show in folder
  src/main/files/service.ts       FileService: the `ewe:fs` ops (list, mkdir, rename, trash, copy, move, open,
                                  terminal, mount, watch, clipboard, drag), the raw/thumb token
  src/main/files/places.ts        computePlaces(): XDG dirs, ewe-files / ewe-drive cloud status, GTK bookmarks,
                                  /run/media, GVFS, rclone mounts, File system, Trash
  src/main/files/thumbs.ts        thumbnails (freedesktop cache, own cache, nativeImage, ffmpegthumbnailer) and
                                  ranged raw file responses
  src/main/files/default-handler.ts  "open folders with ewe browser" through a .desktop file and `gio mime`
  src/main/open-args.ts           command line paths and urls → folder tabs / file tabs
  src/main/ewe-account.ts         reads identity fields from ~/.config/ewe/cloud.json
  src/main/history.ts             frecency scoring and ranking
  src/main/home/recents.ts        RecentsService: recent docs, videos, music and sites from recent.json, GTK
                                  recently-used.xbel, finished downloads and history; parseRecentlyUsed, snippetOf
  src/main/home/service.ts        HomeService: the `ewe:home` ops (token, places, recents, open, mpv, forget)
  src/main/chrome-bookmarks.ts    parseChromeBookmarks() (pure), chromeBookmarkPaths(), readChromeBookmarks() (read-only)
  src/main/storage/               json-file (atomic, serialized writes), settings-store, session-store, history-store,
                                  bookmarks-store, downloads-store, recent-store
  src/preload/index.ts            the only preload; picks the layer from --ewe-layer=shell|overlay|sidebar|page
  src/preload/api.ts              window.ewe (BrowserApi) via contextBridge
  src/preload/chrome-shim.ts      window.chrome for http(s) pages
  src/ui/shell/                   base layer: the tab rail (expanded or collapsed) and the page slot (the page card)
  src/ui/overlay/                 floating layer: rail peek, palette, context menus (tab-menu.ts, workspace-menu.ts),
                                  toast
  src/ui/sidebar/                 right sidebar layer: section tabs, search, resize handle, footer actions
  src/ui/components/              Rail, Palette, Menu, Favicon, Icon (Lucide paths inline)
  src/ui/components/sidebar/      BookmarksPane (tree, drag and drop, inline forms), DownloadsPane, HistoryPane
  src/ui/lib/store.ts             createBrowserStore(): state, settings, theme, account, tabs, workspaces + applyTheme
  src/ui/lib/                     also downloads.ts (createDownloads), favicon.ts (faviconFor), format.ts (bytes,
                                  durations, day labels)
  src/ui/lib/api.ts               typed access to window.ewe
  src/ui/styles/                  tokens.css (Ewe tokens + browser tokens), base.css, components.css, fonts.css
  src/ui/fonts/                   Geist and Geist Mono (OFL)
  src/pages/{newtab,settings,sad}  app:// pages (Solid), pages.css
  src/pages/home/                 the home page (main.tsx, pdf.ts = pdf.js first-page previews, home.css)
  src/pages/files/                the file manager page (main.tsx, viewer.tsx, textview.tsx, archive.tsx, files.css)
  src/pages/music/                the music app (main.tsx, music.css)
  src/main/media/library.ts       MusicLibraryStore (scan, tags via music-metadata, music-index.json), coverResponse
  scripts/visual.mjs              screenshot scenes, drives the app through window.ewe and sendInputEvent
  tests/unit/                     layout, shortcuts, settings-store, session-store, identity, protocol,
                                  ewe-theme, history, ewe-account, bookmarks-store, chrome-bookmarks, downloads-store
  tests/fixtures/                 chrome-bookmarks.json (a Chrome "Bookmarks" file for unit, e2e and screenshots)
  tests/e2e/smoke.spec.ts         25 end-to-end tests; hyprland.ts + global-setup/teardown place windows on workspace 2
docs/PLAN.md                      roadmap, status, open bugs
docs/DESIGN.md                    Ewe design mapping and browser-specific tokens
docs/screenshots/                 generated, untracked
```

## Process model

- `WindowController` creates a frameless, resizable `BrowserWindow` (`titleBarStyle: 'hidden'`,
  background `#0b0a08` dark / `#f4f2ee` light, or ewe `surface-base` when the theme follows
  ewe). Its own `webContents` is the shell layer.
- `win.contentView` children: one `WebContentsView` per tab (only the active one visible), the
  sidebar view (created on first open, `SidebarController`), and the overlay view added last. Every
  tab attach re-raises the sidebar and then the overlay, so the order is pages < sidebar < overlay.
- Every tab lives on `session.fromPartition('persist:default')`. The default session gets the same
  identity and permission handlers. `will-attach-webview` is denied everywhere.
- The overlay view is transparent (`transparent: true`, background `#00000000`), hidden when
  `part === 'none'`, and sized by `overlayBounds(part, size, page)`: rail = the left 264 + 24px
  (shadow room) at full height, toast = centred at the bottom of the page rect, palette and
  menu = whole window.
- The page rect comes from the shell: it always reports its page slot via `layout.report` (right
  of the rail, `PAGE_GAP` 8px from the other edges, or the whole window in fullscreen, where the
  rail is hidden). An open sidebar insets the page from the right
  (`pageBounds(reported, size, inset)`) and the shell pads itself by the same width. The visible
  page view gets `setBorderRadius` with the ewe `--rounded` token (10px by default, 0 in
  fullscreen) so it reads as a card; hidden views are reset to 0, because rounding views that are
  not shown left the shell compositing stale frames on Wayland (the rail stayed collapsed on
  screen while its DOM was expanded).
- Sidebar: a full-height `WebContentsView` on the right (`sidebarBounds`), opaque, background
  synced with the window. Sections `bookmarks | downloads | history` (`SidebarSection`). It pushes
  the page instead of floating over it. Width comes from `Settings.sidebarWidth` (default 360,
  clamped 280–640 and so that the page keeps 320px, `sidebarWidthFor`); dragging the left edge
  sends `sidebar.resize {width}` per frame (live width, not saved) and `{commit: true}` on release
  (saved to settings); a double-click resets to 360. `toggleSidebar(section?)` closes when the same
  section (or none) is asked for and otherwise opens/switches and focuses the search field
  (`sidebar.focus` UiEvent, delayed until the first load finishes). HTML fullscreen hides it.
  The open section is saved per window in the session (`SessionWindow.sidebar`).
- Popups: `setWindowOpenHandler` lets sized `window.open` calls become real windows (page layer
  preload, adopted into a new `WindowController`); everything else becomes a tab that keeps
  `window.opener`.
- Crashes and failed loads navigate the tab to `app://sad/?url=…&error=…`; the sad page offers reload
  to `lastGoodUrl`.

## Layers and the API

One sandboxed preload serves all four layers. `--ewe-layer=` in `additionalArguments` selects:

| layer   | webContents                 | gets                                                                                                                |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| shell   | the window's own            | `window.ewe`                                                                                                        |
| overlay | the overlay WebContentsView | `window.ewe`                                                                                                        |
| sidebar | the sidebar WebContentsView | `window.ewe`                                                                                                        |
| page    | every tab and popup         | `window.ewe` only on `app://` main frames; `window.chrome` shim on http(s) main frames; Safe in every http(s) frame |

Files: the page layer on `app://files/` (main frame only) may call `fs(request)` (`ewe:fs`
invoke, validated by `isFsRequest`, answered by `FileService`); every other layer and page gets
`{ok: false, error: 'Not allowed'}`. Watch events come back as `ewe:fs-changed` to that page only.
`app://files/raw?path=&t=` and `app://files/thumb?path=&t=` are served by the protocol handler only
with the per-run random token, which the page fetches through `fs({op: 'token'})`, so ordinary
web pages cannot read local files through `app://`. `app://settings` may call
`defaultHandler(set?)` (`ewe:default-handler`). `app://home` (main frame only) may call
`home(request)` (`ewe:home`, validated by `isHomeRequest`, answered by `HomeService`) and gets
`ewe:home-changed` pushes; it uses `app://home/raw|thumb|cover?path=&t=` with the same token.

`window.ewe` (BrowserApi): `send(command)`, `getState()`, `getSettings()`, `getTheme()`,
`getAccount()`, `getBookmarks()`, `suggest(query)`, `getDownloads()`, `history(query, limit)`,
`home(request)`, and subscriptions `onState`, `onSettings`, `onTheme`, `onBookmarks`, `onDownloads`,
`onHistory`, `onHomeChanged`, `onUi`.
`getDownloads` and `history` answer only the shell, overlay and sidebar layers (pages get `[]`).

IPC channels (`IPC` in ipc-contract.ts): `ewe:command`, `ewe:get-state`, `ewe:get-settings`,
`ewe:get-theme`, `ewe:get-account`, `ewe:get-bookmarks`, `ewe:suggest`, `ewe:get-downloads`,
`ewe:history`, `ewe:home` (invoke), and `ewe:state`, `ewe:settings`, `ewe:theme`, `ewe:bookmarks`,
`ewe:downloads`, `ewe:history-changed` (sidebars only, throttled to 500ms), `ewe:home-changed`
(home tabs only, throttled to 400ms), `ewe:ui` (main → renderer).
Safe adds `ewe:safe-page` and `ewe:safe-passkey` (invoke, page layer, http(s) frames only) and
`ewe:safe-fill` / `ewe:safe-suggest` (main → one frame); see Safe under ewe integration.

Main validates every command at runtime (`isShellCommand`), checks the sender frame
(`senderFrameUrl`: main frame only, `app://` for the page layer), and applies the per-layer policy
in `WindowController.dispatch`: the page layer may only send `PAGE_COMMANDS`
(`workspace.activate`, `tab.create`, `tab.activate`, `tab.navigate`, `tab.close`, `nav.reload`,
`settings.update`, `open.internal`, `music.play`, `shortcuts.recording`, `bookmarks.importChrome`),
`settings.update`, `shortcuts.recording` and `bookmarks.importChrome` only from `app://settings`,
`music.play` only from `app://home`,
and `tab.navigate` from a page is pinned to that page's own tab. Pages get no `bookmark.*` editing
commands yet; a future bookmarks page adds what it needs.

`InternalPage` (`open.internal`): `'newtab' | 'home' | 'settings' | 'files'`. A fresh profile (no session, or
`restoreSession` off) opens its first window on `app://home/`; Ctrl+T and new windows after that
still use the new-tab flow. Home is never recorded in history (http(s) only).

ShellCommand types: `tab.create {url?, activate?}`, `tab.close {id}`, `tab.activate {id}`,
`tab.move {id, index}`, `tab.navigate {id?, input, newTab?}`, `tab.reopen`, `tab.mute {id, muted}`,
`tab.pin {id, pinned}`, `tab.duplicate {id}`, `tab.moveToWorkspace {id, workspaceId?}` (no `workspaceId` = a new
workspace), `tab.closeOthers {id}`, `tab.closeRight {id}`, `tab.copyUrl {id}` (Electron
`clipboard`), `nav.back|forward|stop`, `nav.reload {id?}` (a page sending it is pinned to its own
tab), `layout.report {page}`, `overlay.request {part, newTab?}` (`part: 'menu'` is
ignored, menus open through `menu.open`), `menu.open {menu: {kind: 'tab' | 'workspace', id}, x, y}` (coordinates from the overlay are
shifted by the overlay view origin in main, so the peek can send its own client coords),
`workspace.rename {id}` (activates the workspace and starts the inline rename in the rail),
`overlay.pin {pinned}`, `workspace.create {name?, color?}`, `workspace.activate {id}`,
`workspace.update {id, name?, color?}`, `workspace.remove {id}`, `workspace.mergeInto {from, to}` (moves every tab of `from` into `to`,
keeps `from` as an empty workspace), `settings.update {patch}`,
`open.internal {page}`, `music.play {path}` (a library track: activates the one music tab and sends
it the `music.play` UiEvent, or opens `app://music/?play=<path>`; any other file opens in the files
viewer), `shortcuts.recording {on}`, `bookmark.toggle {tabId?}` (the active tab by
default; adds or removes every bookmark with that url and shows a toast), `bookmark.add {url,
title, folderId?}`, `bookmark.remove {id}`, `bookmark.update {id, title?, url?, folderId?, index?}`
(`folderId` and/or `index` move the node: `index` is the insertion point in the target folder as
displayed before the move, `folderId` alone appends; cycles are refused),
`bookmark.folder.create {title, parentId?}`,
`bookmarks.importChrome` (the result comes back as a `toast` UiEvent to the sending webContents),
`sidebar.toggle {section?}`, `sidebar.close`, `sidebar.resize {width, commit?}`,
`download {id, action: pause|resume|cancel|retry|open|show|remove}` (`remove` drops the entry,
never the file), `downloads.clear` (finished entries only), `history.remove {url}`,
`window.new|close|minimize|toggleMaximize`, `devtools.toggle`. `menu.open` from the sidebar layer
is ignored (the sidebar renders its own menus).

UiEvent types (main → a renderer): `focus-address`, `overlay.show {part}`, `overlay.hide`,
`palette.open {query?, newTab?}` (the palette reacts to a new `query` while mounted),
`menu.open {menu, x, y}`, `toast {message, icon?: star | download | check | alert}`,
`sidebar.focus`, `workspace.rename {id}`, `music.play {path}` (to the music tab).

State: `WindowSnapshot { windowId, tabs: TabState[], activeTabId, workspaces, activeWorkspaceId,
focused, maximized, fullscreen, sidebar: { section, width } | null }` is broadcast (coalesced to one per 16ms) to the shell, the
overlay and every `app://` tab. `TabState` carries `id, url, title, favicon, loading, canGoBack,
canGoForward, audible, muted, crashed, pinned, kind ('page'|'newtab'|'home'|'internal'),
workspaceId`. Whether a tab is bookmarked is not in the snapshot: renderers derive it from the
bookmark tree (`store.bookmarked()`, a `Set` of urls), so a bookmark change never rebroadcasts
every tab.

## Tabs and workspaces (`tab-manager.ts`)

- `Tab = { view, state, lastGoodUrl, pending }`. `pending` holds a lazy URL for restored tabs; the
  real load happens on first activation.
- Workspaces are `{ id, name, color }` with colours from `WORKSPACE_COLORS` (ewellow, amber, coral,
  rose, violet, sky, mint, slate). Tabs are grouped by `workspaceId`; `insert()` keeps a
  workspace's tabs contiguous. `activateWorkspace` remembers the last active tab per workspace and
  creates a new-tab page when a workspace is empty. `removeWorkspace` refuses to remove the last
  one. Names are capped at 40 characters.
- `create(url, { activate, index, lazy, title, workspaceId })`, `activate`, `close` (picks the
  neighbour inside the workspace or opens a new tab), `move` (inside the workspace), `navigate`,
  `open(input)` (new tab from palette input), `reopen` (closed-tab stack), `cycle`/`select`
  (inside the workspace), `setMuted`, `reload(id?)` (loads a pending tab instead of reloading
  about:blank), `duplicate` (next to the original, activated), `closeOthers` / `closeRight`
  (inside the tab's workspace; the kept tab is activated first so closing never cascades through
  neighbours), `moveToWorkspace(id, workspaceId?)` (undefined creates a workspace without
  activating it; the tab is appended to the target group and, when it is the active tab, stays
  active so the view follows it like Hyprland's `movetoworkspace`), `urlOf(tab)` (the last good
  url for sad tabs), `toSession`.
- Pinning (`setPinned(id, pinned)`, command `tab.pin`, menu only): pinned tabs sit first inside
  their workspace. `groupOf(workspaceId)` returns the group's `start`, `pinnedEnd` and `end`
  indexes; `insert()` puts a pinned tab at the end of the pinned group and never puts an unpinned
  tab inside it (explicit indexes are clamped, so a duplicate of a pinned tab lands right after
  the group, unpinned, as in Chrome). Pinning moves the tab to the end of the pinned group,
  unpinning moves it to the start of the unpinned group. `move` clamps inside the tab's own group.
  `closeOthers` and `closeRight` skip pinned tabs; `close` (Ctrl+W, middle click, the menu) closes
  a pinned tab like any other and `reopen` brings it back pinned. `toSession` writes `pinned` per
  tab and `WindowController` restores it (the active tab is resolved from the created tabs, not
  from a list index, because `insert()` may reorder a hand-edited session).
- `wire()` listens per tab: `did-start/stop-loading`, `did-navigate` (records history),
  `did-navigate-in-page`, `page-title-updated` (updates history title), `page-favicon-updated`,
  `audio-state-changed`, `did-fail-load` → sad page, `render-process-gone` → sad page,
  `before-input-event` → `matchShortcut`, `input-event` → mouse hooks, `focus`.
- Shortcuts are table-driven: `DEFAULT_SHORTCUTS` (action → chord strings such as `Ctrl+T`,
  `Alt+Shift+1-9`, `F5`; physical key codes, Ctrl and Meta equivalent) merged with
  `Settings.shortcuts` (a per-action override replaces that action's defaults; empty or invalid
  entries dropped by `sanitizeShortcuts`). `1-9` in a chord means digits (9 = last) and is valid
  only for `tab.select` / `workspace.select`. Defaults: Ctrl+T new tab (palette), Ctrl+W/F4 close,
  Ctrl+L/E address, Ctrl+K / Ctrl+Shift+P palette, Ctrl+R/F5 reload, Ctrl+Shift+R hard reload,
  Ctrl+N / Ctrl+Shift+N new window, Ctrl+Tab/PageDown next tab, Ctrl+Shift+Tab/PageUp prev,
  Ctrl+1-9 and Alt+1-9 select tab, Alt+Shift+1-9 select workspace, Ctrl+Shift+PageDown/PageUp and
  Ctrl+Alt+Right/Left workspace next/prev, Alt+Home home page, Ctrl+D bookmark toggle,
  Ctrl+= / Ctrl+- / Ctrl+0 zoom,
  Ctrl+[ / Ctrl+] and Alt+Left/Right back/forward, Ctrl+Shift+T reopen, Ctrl+Shift+W close window,
  Ctrl+Shift+I / F12 devtools, F11 fullscreen, Ctrl+Shift+Q quit. Main applies changes live
  (`setShortcuts` on the settings `change` event). While `app://settings` records a chord it sends
  `shortcuts.recording {on}`; `TabManager` skips `matchShortcut` for that webContents. Chords with
  Ctrl+Alt plus a printable character are ignored as AltGr. Alt+Tab belongs to Hyprland.
  ignored. Playwright's CDP keyboard bypasses `before-input-event`, so tests send keys with
  `webContents.sendInputEvent`.

## Overlay and hover state machine

- Parts: `none | rail | palette | menu | toast | prompt | suggest | sheet` (Safe's save prompt,
  inline list and passkey sheet; see Safe below). `OverlayController.show(part, size, extra?, at?)` sets
  bounds, makes the view visible, records `shownAt`, sends `overlay.show {part}` on a part change,
  then any `extra` UiEvent. `hide()` sends `overlay.hide` (the UI adds `.leaving` for the exit
  animation), waits `HIDE_ANIMATION_MS` = 160ms, hides the view and sends `overlay.show none`.
  Leaving `menu` for another part keeps the full-window bounds for the same 160ms (`shrinkTimer`,
  cancelled by any later show, hide or relayout) so the menu can fade out before the view shrinks.
- Context menus: a right-click on a rail tab, pinned tile, workspace head or workspace dot sends
  `menu.open {menu: {kind: 'tab' | 'workspace', id}, x, y}` from the shell (window coordinates)
  or from the peek (overlay coordinates, shifted by the overlay origin in main). Main shows part
  `menu` (whole window, focused) and echoes `menu.open` to the overlay, which renders `Menu` at
  the pointer inside a transparent `.menu-backdrop` that swallows the outside click. When the menu
  came from the peek (`under === 'rail'`) the peek stays mounted under it. Closing (Escape, outside
  click, window blur, an item) marks the menu `leaving` and requests `rail` (peek under) or
  `none`; the overlay unmounts the fading menu after `MENU_FADE_MS` = 160ms. Part `menu` is modal:
  `onPageMouse` ignores it like `palette`. Menus re-place themselves on `resize`, and `placeMenu`
  clamps into the viewport even when the anchor lies outside it (the overlay can grow after the
  menu mounted).
- Rail peek: in collapsed mode, hovering the shell rail for 250ms sends `overlay.request rail`;
  the overlay renders the expanded `Rail` in `peek` mode (`.rail.peek`, `shadow-float` plus a
  scrim-coloured spread). It hides when a page mouseMove lands right of the peek (after 250ms,
  never while `overlay.pin` is set, i.e. while renaming or editing in it) or when the overlay
  document fires `mouseleave` after a `mousemove`. In fullscreen (rail hidden, not HTML
  fullscreen) the left 12px edge (`hoverZone`, 24px on `mouseLeave`) reveals the same peek.
- Palette: `openPalette(newTab)` shows the palette over the whole window and sends
  `palette.open`. Enter navigates (`tab.navigate {input, newTab}`), Escape or a backdrop click
  sends `overlay.request none`.
- Toast: `WindowController.toast(message)` shows part `toast` (a `TOAST_WIDTH` 360 ×
  `TOAST_HEIGHT` 56 rect centred at the bottom of the page rect, `overlayBounds`), sends `toast
{message}` and hides again after `TOAST_MS` 1800ms, but only when no other part is showing (with
  a peek or a menu open the star state itself is the feedback) and only while the part is still
  `toast` when the timer fires. The view does not take focus; a peek replaces it like `none`. The overlay renders `.toast` (pill, `surface-overlay`, star in `accent-text`) in
  a pointer-transparent `.toast-host`. Used by `bookmark.toggle` ("Bookmark added" / "Bookmark
  removed"); the Chrome import result goes straight to the settings page's webContents instead.
- Sidebar UI (`ui/sidebar/App.tsx`): a segmented header (the active section shows its label,
  the others are icons; a count badge on Downloads while something is running), a close button,
  one search field per section (Escape clears it, then closes the sidebar; Ctrl+F focuses it;
  Enter opens the first row), the pane, and a footer (Bookmarks: "Bookmark this tab" /
  "Remove this tab", New folder; Downloads: Clear finished). Arrow keys move between rows
  (`[data-row]`). Menus open inside the sidebar document (`.sb-menu-backdrop` + `Menu`).
  - `BookmarksPane`: an expandable tree (expanded folder ids in `localStorage`), favicon well, host
    hint on hover, folder counts. Click opens in the current tab, Ctrl/middle click in a new tab.
    Right-click: Open, Open in new tab, Edit, Delete; on folders Open all, New folder inside,
    Rename, Delete folder. Enter/Right/Left/F2/Delete on a focused row. Edit and New folder swap in
    an inline form (`.sb-form`). HTML5 drag and drop: the top quarter of a folder drops before it,
    the middle into it, the bottom quarter after it (into, when the folder is open); bookmarks drop
    before or after by half. A search flattens the tree and shows the folder path as the hint.
  - `DownloadsPane`: rows with a file well, name, a status line (size of total, speed, time left;
    paused; size and host; Cancelled; Failed) and a progress bar for active downloads; actions per
    status (pause/cancel, resume/cancel, show in folder/remove, retry/remove). Click on a
    completed row opens the file. `<Index>` keeps the DOM across the 250ms progress updates.
  - `HistoryPane`: `api.history(query, 400)` grouped by day (Today, Yesterday, weekday, date),
    reloaded on `onHistory`; hover swaps the time for a remove button; right-click Open, Open in new
    tab, Copy link, Remove from history.
- Downloads (`DownloadManager`): every download on `persist:default` is saved to
  `$EWE_DOWNLOADS` or `~/Downloads` under a unique name (`uniquePath`: "name (1).ext"; names are
  stripped of paths and control characters), without a dialog. Progress updates are throttled to
  250ms unless the status changes. Start and finish raise toasts ("Downloading x" with the
  download icon, "Downloaded x" with a check, failures with the alert icon in `danger`). A tab that
  only existed to start a download (blank url, no history, not the last tab) is closed.
- Workspaces in the rail: the header shows the active workspace (dot, name, tab count);
  double-click renames it inline. The dots in the footer switch workspaces (click), open the
  workspace menu (right-click) or rename (double-click). `workspace-menu.ts` builds Rename, the
  colour swatch row, Move tabs here (submenu of other workspaces with tab counts) and Remove
  (disabled for the last workspace). The menu's Rename is routed through main: the overlay sends
  `workspace.rename {id}` after the menu closes, main activates that workspace and sends the
  `workspace.rename` UiEvent to the shell (expanded rail) or shows the peek with it (collapsed).
  The input focuses itself from its `ref`, because the rename event arrives before the state
  broadcast that switches the header to that workspace. Enter or blur commits, Escape cancels,
  empty keeps the old name, 40 characters at most.
- Gotcha, verified in Electron 44 source: in a windowed frameless window on Linux any
  `-webkit-app-region: drag` area swallows mouse events before they reach a `WebContentsView`
  (`NativeWindowViews::ShouldDescendIntoChildForEventHandling` returns false when
  `NonClientHitTest` is not `HTNOWHERE`; fullscreen short-circuits that check). The rail is
  `no-drag`; there is no drag region at all (Hyprland tiles the window).

## Files (`app://files`, roadmap step 3)

- Opening: Ctrl+Shift+E, the rail's folder button, `open.internal {page: 'files'}`, typing `/path`,
  `~` or `~/path` in the rail address field or the palette (`resolveInput` →
  `filesUrl(path)`), Downloads → Show in folder (`filesUrl(dir, select)`), or the command line
  (`openArgs`: folders become files tabs, files become `file://` tabs, also from a second
  instance). Tabs are `kind: 'files'`; the rail shows a folder glyph and the path in the address
  field (parent muted, folder name bright). Folder changes use `history.pushState`, so back and
  forward (rail, Alt+Left/Right, Backspace) walk folder history; the tab title is the folder name.
- Places (`computePlaces`): Home, the XDG dirs that exist (`user-dirs.dirs`, incl. Projects),
  Nextcloud and Google Drive from `~/.local/share/ewe/bin/ewe-files status` / `ewe-drive status`
  (`$EWE_BIN` overrides; `ready` when mounted, `offline` → "Connect" runs `… mount`, `setup` →
  a hint to sign in from ewe Settings; hidden when the tool is missing), GTK bookmarks
  (`~/.config/gtk-3.0/bookmarks`; trailing slashes are stripped, so `file:///home/me/Nextcloud/`
  gets a label and dedupes with the Nextcloud place), `/run/media/$USER/*`, GVFS mounts under
  `/run/user/$UID/gvfs` (labels from `gvfsLabel`), other `fuse.rclone` mounts, File system and
  Trash (`$XDG_DATA_HOME/Trash/files`).
- Operations (all in main): list (lstat in batches, symlinks resolved, writable, free space),
  mkdir, rename (refuses an existing name), trash (`shell.trashItem`; `$EWE_TRASH_DIR` moves into
  a folder instead, used by e2e), copy / move (unique "name (1).ext" names, EXDEV falls back to
  copy + delete, a folder cannot go into itself), open with the system default
  (`shell.openPath`), open a terminal ($TERMINAL, kitty, foot, alacritty, …), mount, watch
  (`fs.watch`, 200ms debounce, one per page), a cut/copy clipboard shared by every files tab, and
  native drag-out (`startDrag`). Dropping the dragged items on a folder tile, place or crumb
  moves them (Ctrl copies).
- Thumbnails: the freedesktop cache (x-large, large, normal, by md5 of the file URI, fresh by
  mtime) is read first, so Nemo's thumbnails are reused; otherwise png/jpeg are scaled with
  `nativeImage` and videos go through `ffmpegthumbnailer`, both into
  `$XDG_CACHE_HOME/ewe-browser/thumbnails` (never into the shared cache); other images under 25MB
  are served raw. At most three generations run at once.
- Page: places panel; toolbar (back, forward, up, breadcrumbs that become a path field on a click
  in empty space, a filter field that also catches type-ahead, new folder, hidden files, sort
  menu, grid/list); grid tiles or list rows with sortable headers; status line (counts,
  selection size, free space); notices; context menus for entries and the background. Keys:
  arrows (grid-aware), Shift/Ctrl selection, Enter / Ctrl+Enter, Backspace back, Alt+Up parent,
  F2 rename (name without extension selected), Delete to Trash, Ctrl+A/C/X/V, Ctrl+F filter,
  Escape. View, sort and hidden are remembered in `localStorage`.
- Opening files: images, videos and audio open in the in-page viewer (`pages/files/viewer.tsx`,
  a full-window overlay over the folder: arrows and Home/End step through the folder's media,
  click toggles actual size for images, audio advances at the end, Esc closes; buttons for a new
  tab and the default app). "Open in new tab" opens `filesUrl(dir, name)&view=1`, which shows the
  same viewer over that folder. Media is served by `app://files/raw` with Range support.
  Archives open the archive dialog (`pages/files/archive.tsx`: contents from `bsdtar -tvf`, up to
  2000 rows, Extract here, Archive manager, Cancel). Everything else, and "Open with default
  app", goes through `gio open` (GIO defaults, like Nemo; falls back to `shell.openPath`), so
  AppImages open in komble and zips in Engrampa instead of xdg-open picking a browser.
- Archives (`main/files/archive.ts`, all through `bsdtar` without a shell): `archive.list`,
  `extract` (an archive with one top folder that does not exist yet is extracted next to it;
  otherwise into a new "name (n)" folder; a failed extraction removes its folder) and
  `compress {paths, format: zip | tar.gz | tar.zst}` (items from one folder, named after the
  single item or "Archive", unique). The entry menu has Compress ▸ and, for archives, Extract here.
- AppImages, flatpak refs and snaps are kind `package` (Lucide `package` glyph in `accent-text`).
- Tile thumbnails keep their loaded/failed state in a signal keyed by the entry path; an earlier
  version added `has-thumb` to the DOM by hand, and `<Index>` reused that node for a folder in the
  next listing, hiding the folder glyph.
- Default handler: Settings → Files → "Use ewe browser" writes
  `$XDG_DATA_HOME/applications/ewe-browser-folders.desktop` (`NoDisplay`, only `inode/directory`,
  `Exec` = this Electron binary, plus the app path in dev) and runs
  `gio mime inode/directory ewe-browser-folders.desktop`, saving the previous default in
  `default-handler.json`; "Give back" restores it (Nemo when unknown). `xdg-mime query` did not
  report what it had just set on this machine, so `gio mime` is used for both.

## Home (`app://home`)

- Opened on first launch, by Alt+Home and `open.internal home`. Top to bottom: greeting and date,
  a hero search (the `Palette` with `hero`: a `control-2xl`-plus pill, results drop down over the
  page only while focused and only once something is typed, Escape clears then blurs), folder
  shortcuts and Recent. Typing anywhere on the page focuses the search.
- Shortcuts are `computePlaces()` minus the `other` group and `setup` clouds (12 at most): Home,
  the XDG dirs, Nextcloud / Google Drive (an `offline` cloud gets a `warning` dot), GTK bookmarks,
  devices. Rows are balanced (`ceil(n / ceil(n / 9))` columns). Click opens the folder in this
  tab, Ctrl or middle click in a new one.
- Recent shows 5 cards (`HOME_RECENT_LIMIT`) with a filter (All, Docs, Videos, Music, Web, kept in
  `localStorage`). `RecentsService.collect(filter, limit)` merges: `recent.json` (files the files
  page opened in its viewer, with the default app or mpv, and tracks the music page played),
  `$XDG_DATA_HOME/recently-used.xbel` (GTK recent files, so Nemo/mpv opens count; read-only,
  cached by mtime, the newest of a bookmark's stamps), completed downloads, and history (search
  result pages skipped, one page per host). Only existing files whose `recentKindOf` is doc (pdf,
  office documents, sheets, slides, txt/md/rst/org), video or audio count; images, code and
  configs do not. `pickRecents` takes the newest of each kind first and fills by time, so web
  visits cannot crowd out files. Audio is enriched from the music library (title, artist, cover),
  text docs get a 16-line snippet. "Remove from Recent" (`forget`) hides a key until it is used
  again after that time.
- Cards: videos show the thumbnail route's frame, music the cover (blurred backdrop plus the art),
  PDFs their first page rendered by pdf.js (`pages/home/pdf.ts`, worker from
  `pdfjs-dist/build/pdf.worker.min.mjs?url`, cached per path and size), text docs their snippet,
  other docs a paper with an extension label (or a freedesktop cached thumbnail), sites the
  favicon on a white tile over its blurred copy. Click: sites navigate, music goes through
  `music.play`, viewable files open the files viewer (`viewerUrl(path)`), other documents open
  with the default app (`home {op: 'open'}`, allowed only for paths the last `recents` answers
  returned). Ctrl/middle click opens a new tab. The context menu adds Play in mpv, Open with
  default app, Show in folder, Copy path/link and Remove from Recent.
- Refresh: on load, on `ewe:home-changed` (main pushes it when `recent.json`, history, the music
  library or the number of completed downloads change), on `visibilitychange` and window focus.
  `visibilitychange` and `focus` do not fire for a window on a hidden Hyprland workspace, so the
  push is what keeps the page current in tests.

## Extensions, DRM and sync (roadmap step 6)

- Runtime: castlabs Electron for Content Security `v44.5.1+wvcus` (`electron` in
  apps/browser/package.json points at the castlabs GitHub tag; its package has no postinstall,
  so apps/browser's own `postinstall` runs `node_modules/electron/install.js`). Main waits up to
  2.5s for `components.whenReady()` before opening windows; the Widevine CDM lands in
  `<userData>/WidevineCdm` on first launch. Under Playwright the component updater does not run,
  so tests cannot download the CDM.
- `app.enableSandbox()` in `bootstrap()` is required: without it Electron runs with
  `no-sandbox`, and service-worker preload scripts never execute (electron#54322), which breaks
  every MV3 extension.
- `ExtensionHost` (`main/extensions.ts`): one `ElectronChromeExtensions` (license `GPL-3.0`) on
  `persist:default`, tabs registered through TabManager's `onTabCreated` / `onTabActivated`
  (active tab follows the focused window), `createTab` / `selectTab` / `removeTab` /
  `createWindow` wired to the window manager. `installChromeWebStore` loads and auto-updates
  extensions from `$EWE_EXTENSIONS` or `<userData>/Extensions`. Action state is read from the
  library's `api.browserAction.actionMap` (an observer object triggers a 50ms-coalesced
  `ewe:extensions` broadcast of `ExtensionsState { partition, tabId, list }`).
  `extensionIconUrl()` builds `crx://extension-icon/<id>/32/2?…`; `crx` is registered as a
  privileged scheme in `registerAppScheme` (a second `registerSchemesAsPrivileged` call would
  replace the library's) and handled on both sessions.
- Extension pages and workers get one more preload, `out/preload/extension.js`, which points
  `globalThis.browser` at the library's patched `chrome`: Chromium 152 ships a native `browser`
  namespace without those APIs, and extensions such as uBlock Origin Lite prefer `browser`.
- Popups: `PopupHost` shows `chrome-extension://…/popup.html` in a `WebContentsView` above the
  overlay, laid out off-screen at 800×600 until `MEASURE_POPUP` (html `max-content`) gives its
  size, then placed by `popupBounds` under the button (flipping up, clamped, 25–800 × 25–600),
  rounded like the page. Blur, Escape, a second click or `window.close()` closes it.
- Installs: the Web Store's own button refuses non-Chrome browsers (even with the
  `Google Chrome` brand added to `navigator.userAgentData` and `Sec-CH-UA` for that host, which
  `chrome-shim.ts` and `identity.ts` still do), so `extension.install {source}` (a store url or
  id, `storeExtensionId`) downloads the CRX with `downloadExtension`, reads name (resolving
  `__MSG_` keys), icon and permissions, shows the overlay `InstallPrompt` (UiEvent
  `extension.install`, answered by `extension.confirm {requestId, allow}`), then loads it or
  deletes the download. The rail shows `.rail-store-add` on store detail pages of extensions not
  yet added; Settings has a link field.
- Commands: `extension.activate {id, x, y, width, height}`, `extension.options {id}`,
  `extension.remove {id}`, `extensions.update`, `extension.install {source}`,
  `extension.confirm`; `menu.open {kind: 'extension', id}` builds `extension-menu.ts`.
- Sync (`main/sync/`): `nextcloudAccount()` takes the app password from `ewe-cloud token
--json` and the WebDAV root from `ewe-cloud webdav-url` (the login name is not the path
  segment) and sends a browser user agent (Cloudflare in front of the owner's Nextcloud returns
  error 1010 to Python/Node defaults). `$EWE_SYNC_URL` replaces all of it for tests. Files
  `ewe/browser/{bookmarks,history,settings}.json` hold `{ version: 1, machine, savedAt, data }`;
  `<userData>/sync/<kind>.base.json` keeps the last merged state. `merge3` decides per key
  (one-sided changes win, an edit beats a delete, real conflicts use a resolver: bookmarks local,
  history max count / newest title, settings local, or remote on a machine's first sync). Bookmarks
  are flattened to `{kind, title, url, parent, index, added}` and rebuilt (orphans and cycles go to
  the root). PUT uses `If-Match` / `If-None-Match: *` and retries twice on 412.
  `Settings.sync` toggles it; `ewe:sync` (invoke, `app://settings` only) returns or runs
  `SyncStatus`, pushed as `ewe:sync-status`. `SettingsStore.flush()` now runs on quit.

## ewe integration (roadmap step 5)

- Passwords (`main/passwords.ts`): the tool is `$EWE_PASS`, else `ewe-pass` in the ewe bin dir,
  else the copy inside `~/.config/ewe/plugins/ewe.passwords`. `ewe:passwords` (invoke, overlay
  layer only) runs `status` then `match --class ewe-browser --title <active host> [--query q]`
  and returns `{ status, items }` (ids, titles, usernames, hosts; never secrets). Command
  `passwords.open` (also shortcut `passwords`, Ctrl+Shift+L, and `.rail-key`) shows part
  `palette` and sends UiEvent `passwords.open {host}`; the overlay renders `Passwords` instead of
  `Palette`. `passwords.fill {id, what}` hides the overlay, focuses the window and page, runs
  `focusScript(what)` in isolated world 1009 (keeps a focused text field, else the username field
  before the first visible password field, else the password field) and then
  `ewe-pass fill <id> --pid <main pid> --what <what>`, which types through wtype.
  `passwords.copy {id, what}` runs `ewe-pass copy`. Errors come back as toasts.
- Safe (`main/safe/`, `preload/safe/`, `ui/overlay/Safe*.tsx`, `PasskeySheet.tsx`, `safe-menu.ts`,
  `safe.css`, `components/SafePrompt.tsx`; ewe-safe RFC-008, its `docs/PROTOCOL.md` v1 and
  `docs/TRIO.md` §B1/§S1):
  - Core: `SafeClient` (`client.ts`) speaks NDJSON v1 to `$EWE_SAFE_SOCKET` or
    `$XDG_RUNTIME_DIR/ewe-safe.sock` (one connection per call, plus a `subscribe` connection with
    backoff, started on first use). `SafeService` (`service.ts`) holds menu requests and captured
    logins; `SafeWindow` (`window.ts`, one per `WindowController`, field `safeUi`) owns the inline
    list, the passkey sheet and the save prompt; `registerSafeIpc` (`ipc.ts`) answers
    `ewe:safe-page` and `ewe:safe-passkey` (invoke, page layer, http(s) frames only). Window
    manager code only delegates (`safe.*` commands from the overlay layer → `safeUi.command`).
  - Page preload (`preload/safe/content.ts`, every http(s) frame since page views set
    `nodeIntegrationInSubFrames`): `forms.ts` classifies inputs (login / new-password /
    one-time code; `autocomplete="… webauthn"` counts as a username field), a key in the focused
    field (closed shadow root; its two colours are literals because a page has no ewe tokens).
    Requests (`isSafePageRequest`): `state` → `{enabled, suggest, capture}`, `open {kind, field:
username | password | code, rect, trigger: focus | click | key | icon}`, `move {rect}`, `key
{key}`, `filter {text}`, `blur`, `focus`, `close`, `submit {kind, username, password}`.
  - Inline list (1Password-style): `open` is sent on a field focus that follows a trusted
    pointerdown on the field (or its label) or a trusted Tab within 1s, never on script focus or
    page load; also on a click into the already focused field, ArrowDown in an empty field, and
    the key. `Settings.safe.suggest` off = only the key and ArrowDown. `rect` is the field in the
    top frame's CSS px (same-origin frames add their `frameElement` offsets; a cross-origin frame
    sends `null` and the list opens at the last page pointer). Main shows part `suggest` at an
    explicit rect (`suggestBounds`: under the field, flipped above when there is no room, 280–420
    px wide, `SUGGEST_PAD` 12 = CSS `--suggest-pad` of shadow room, × the tab's zoom) without
    focusing the overlay; if the overlay gets focus anyway (a click on a row) main gives it back
    to the page. Focus/click opens only when there is something to show (logins, passkeys, a
    strong password, or Unlock Safe). The overlay (`SafeSuggest`) reports its height (`safe.fit
{requestId, height}`, 0 hides the view) and whether a row is selected (`safe.selected`); main
    forwards that to the frame as `ewe:safe-suggest {open, visible, selected}`. While it is open
    and visible the preload takes ↑ ↓ Esc, and Enter only when a row is selected, from a
    window-capture keydown listener (installed before page scripts) and sends `key`; typing in a
    username field sends `filter` (rows match title, username or host; no match hides the list),
    typing in a password or code field closes it; `blur` closes it after 200ms unless `focus`
    comes back; scroll and resize send `move`; navigation, a tab switch, window blur and any other
    overlay part close it. Rows: passkeys of a waiting conditional request first, then logins
    (favicon of the tab, title, username), footer Open Safe / Use a strong password / Unlock Safe.
    Commands: `safe.choose {requestId, id}`, `safe.passkey {requestId, credentialId}`,
    `safe.generate`, `safe.unlock` (reopens the list after `ewe-safe unlock --ask`),
    `safe.openApp`, `safe.close`. Against clickjacking a mouse pick counts only after the list
    has stood still for 500ms and the pointer has moved since (main sends `safe.suggest.moved`
    whenever the list moves); the preload ignores untrusted scroll, resize and submit events.
  - Fill: a request remembers the tab, the frame (process and routing id) and its origin; a fill
    re-checks that the frame still has that origin and that the login was offered to it, then
    sends `ewe:safe-fill` (`SafeFill`) to that frame only (native setter + `input`/`change`).
    Site matching (`site.ts`, `tldts`): exact host, then registrable domain, https never to http,
    ports equal; ties sort by username.
  - Passkeys (WebAuthn): `preload/safe/passkeys.ts` runs `pageScript` (`page-script.ts`, fully
    self-contained because Electron serializes it) in the main world with
    `contextBridge.executeInMainWorld` at document start (verified: before the page's first
    `<head>` script, in subframes too), passing a bridge of four functions (`available`,
    `create`, `get`, `abort`) that call `ewe:safe-passkey`. It replaces
    `navigator.credentials.create/get` for `publicKey` requests only (all else, and Safe not set
    up or `Settings.safe.passkeys` off → the original), and
    `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable`,
    `isConditionalMediationAvailable` and `getClientCapabilities` (true / merged when Safe is set
    up). Options travel as base64url JSON; replies are WebAuthn L3 JSON, turned into objects
    whose prototypes are the real `PublicKeyCredential` / `Authenticator*Response` ones
    (`getTransports` `["internal","hybrid"]`, `getAuthenticatorData`, `getPublicKey`,
    `getPublicKeyAlgorithm`, `authenticatorAttachment: "platform"`, `credProps.rk` when asked,
    `toJSON`). `AbortSignal` is honoured (the bridge sends `abort`). Main (`webauthn.ts`,
    `passkeys.ts`, `window.ts`) takes the origin from `senderFrame`, refuses opaque origins and
    frames not same-origin with every ancestor (`NotAllowedError`), checks the RP ID
    (`checkRpId`: https, or http only on `localhost`; the host or a registrable suffix, never a
    public or private suffix, no IPs, lower case), validates options (`parseCreate` /
    `parseGet`: user id 1–64 bytes, timeout clamped 30 s–10 min), builds `clientDataJSON`
    (`type, challenge, origin, crossOrigin: false`) and its SHA-256 and calls Safe's
    `passkey-list` / `passkey-create` / `passkey-get`. Replies are checked (credential id,
    RP ID hash, UP / AT flags) before they reach the page. Modal create/get show part `sheet`
    (whole window, focused; `PasskeySheet`: Save / pick a passkey, Use a security key instead
    (→ the original API, with our own timeout), Cancel; locked → Unlock Safe first; a click
    counts only 500ms after the sheet appeared and after the pointer moved, and Enter acts only
    after an arrow key or Tab, with no passkey selected at first); only the active tab, one sheet
    at a time. The bridge sends the document's `location.origin`, which must equal the sender
    frame's origin, and Save / pick re-check that the frame still has that origin. The site's
    user name and display name are shown cleaned (`displayText`: no control, bidi or invisible
    characters, 64 characters at most). Conditional `get` waits
    per frame (`PasskeyBroker.wait`; a new one replaces the old; requests of frames that are gone
    are dropped on every frame navigation) and its passkeys head the inline list; a pick is
    signed only for the very request the list was built for. A create into an existing login (`item_id`) only when the site's user name equals the
    login's username, the host matches exactly and Safe says that login has no passkey
    (`passkey: null`). Errors: `excluded` → `InvalidStateError`, `unsupported` →
    `NotSupportedError`, cancel / timeout / locked / not-found → `NotAllowedError`, abort →
    `AbortError`, bad RP ID → `SecurityError`, bad options → `TypeError`.
  - Save: `SafeWindow.capture` waits for the tab's next navigation (or 2.5s), `SafeService.prompt`
    reveals the saved passwords of the same username to compare (`decide.ts`), and part `prompt`
    (`PROMPT_WIDTH` 380 × `PROMPT_HEIGHT` 168 at the page's top right, `PROMPT_MARGIN` 12; no
    focus, ignored by the page mouse hooks and the overlay's mouseleave) shows `SafePromptCard`;
    `safe.prompt {promptId, action: save | update | never | dismiss}` settles it, any other part
    dismisses it, 60s hides it.
  - `Settings.safe { fill, suggest, passkeys, offerSave, neverSave }` (`sanitizeSafeSettings`, 500
    hosts). Unlock runs `ewe-safe unlock --ask` (`$EWE_SAFE_BIN` or `PATH`); Open Safe runs
    `ewe-safe-app` (`$EWE_SAFE_APP` or `PATH`). Nothing logs titles, usernames or values.
- Web panels (`main/panels.ts`): `Settings.panels: WebPanel[] { id, url, title }` (12 at most,
  `sanitizePanels`). Sidebar sections may be `panel:<id>`. `PanelHost` keeps one
  `WebContentsView` per opened panel (page preload, the default session, popups become tabs,
  non-http navigations refused), shown at `panelBounds(sidebar)` = below the 44px sidebar header
  (`SIDEBAR_HEADER`) and `PANEL_INSET` 6px right of the resize grip, raised between the sidebar
  and the overlay. `panel.add {url, title?}` / `panel.remove {id}` are allowed from the sidebar
  and `app://settings`; removing prunes the view and closes the sidebar if it showed it.
- Resident process: `Settings.background` keeps the app alive on `window-all-closed`;
  `--background` starts without a window. `second-instance` with no windows flushes and
  reloads the session (or Home) and then opens any targets. `openArgs(argv, cwd, self)` skips
  the app's own path (dev runs `electron <app>`). `Startup` (`main/startup.ts`) reads and
  writes `apps.startup` through `ewe-conf get/set`, adding `{ name: 'ewe browser', exec:
'<app> --background' }`; `ewe:startup` (invoke, `app://settings` only, optional boolean)
  returns `{ available, on }`.

## Viewers and music (roadmap step 4)

- The files viewer (`viewer.tsx`) shows images, video, audio, text, code, Markdown and PDF and
  steps through every viewable file of the folder. `textview.tsx` fetches the file from the raw
  route (the first 2MB of larger files), highlights code with highlight.js core and 24
  registered languages (by extension, colours mapped to Ewe status tokens), renders Markdown with
  marked + DOMPurify (relative images rewritten to raw URLs, links open in new tabs; the
  sanitized HTML is set through a ref, so `solid/no-innerhtml` stays on), and shows PDFs in an
  iframe, where Chromium's own PDF viewer takes over. Raw URLs end in the file name
  (`/raw/<name>?path=…&t=…`) so the PDF toolbar and downloads show it. The page refocuses after
  the PDF loads so Esc still closes the overlay.
- mpv: `fs {op: 'mpv'}` spawns `mpv --force-window=immediate -- <path>`; videos have Play in mpv in
  the menu and the viewer, and the viewer offers it when Chromium cannot decode the file.
- Music (`app://music`, rail button, one tab: `open.internal music` activates an existing music
  tab): `MusicLibraryStore` walks `$EWE_MUSIC_DIR` or `XDG_MUSIC_DIR` (12 levels, 50000 tracks,
  four parsers at once), reuses entries whose mtime and size did not change, and keeps
  `music-index.json` (`{ version: 1, tracks }`). The page asks `music {op: 'library'}` (the first
  ask starts a scan), `rescan`, `token`; changes arrive as `ewe:music-changed`. Audio and covers
  come from `app://music/raw` and `app://music/cover` with the same token as files; covers are
  the embedded picture or a cover/folder image next to the file, cached in
  `$XDG_CACHE_HOME/ewe-browser/covers`. Views: Albums (grid, album detail with Play / Shuffle),
  Artists, Songs, search; a now-playing bar with shuffle, previous, play, next, repeat (off / all
  / one), seek and volume; volume, repeat, shuffle, queue and view are kept in `localStorage`.
  The page sets `navigator.mediaSession` metadata, artwork and actions, and Chromium publishes
  that over MPRIS (the e2e test sees `org.mpris.MediaPlayer2.*` for the app's pid on the session
  bus), so the ewe media controls and media keys drive it.

## Storage (all JSON under the user-data directory, atomic writes via `json-file.ts`)

- `settings.json`: `Settings { rail: 'expanded'|'collapsed', searchEngine: google|duckduckgo|bing|
kagi|brave, theme: 'system'|'dark'|'light', restoreSession, sidebarWidth, shortcuts }` with `DEFAULT_SETTINGS`.
  Changes broadcast to every renderer and sync `nativeTheme.themeSource`.
- `session.json`: windows with `bounds`, `tabs [{ url, title, workspace, pinned }]`, `activeIndex`,
  `workspaces [{ id, name, color }]`, `activeWorkspace`. The exact validator is `isSessionFile` in
  `session-store.ts`; `sanitizeWindows` drops unrestorable URLs, clamps indexes and name length,
  and turns a missing `pinned` (files written before tab pinning) into `false`.
  Saved 1s after any change, on window close and on quit.
- `history.json`: one entry per URL with title, host, visit count and last visit;
  `recordable()` keeps http(s) only; at most 20000 entries; writes debounced 2s.
  Ranking (`history.ts`): host-prefix 4, host-contains 2, title 1.5, url 1, multiplied by
  `1 + log2(count)` and `exp(-ageDays / 45)`. `suggest(query, 6)` feeds the palette;
  `complete(typed)` feeds the inline host completion in the url editor.
- `bookmarks.json`: `{ version: 1, root }` where `root` is a `BookmarkFolder { id: 'root', kind,
title, children, added }` and children are `{ id, kind: 'bookmark', title, url, added }` or
  nested folders. New bookmarks (Ctrl+D, the star, `bookmark.add` without a folder) land directly
  in the root. `isBookmarksFile` validates the shape recursively (16 levels at most);
  `sanitizeBookmarks` drops non-http(s)/app urls (never `app://newtab` or `app://sad`),
  regenerates empty or duplicate ids, caps titles at 500 characters and clamps timestamps. Writes
  debounced 500ms, flushed on quit; every change emits `change`, which main broadcasts as
  `ewe:bookmarks` to every renderer. Chrome import (`chrome-bookmarks.ts`) reads
  `$EWE_CHROME_BOOKMARKS`, then `~/.config/google-chrome/Default/Bookmarks`, then
  `~/.config/chromium/Default/Bookmarks` (read-only, first readable wins), maps `roots.bookmark_bar
/ other / synced` to "Bookmarks bar" / "Other bookmarks" / "Mobile bookmarks" folders inside
  "Imported from Chrome (YYYY-MM-DD)", converts `date_added` (microseconds since 1601) and skips
  non-http(s) urls and empty roots; `replaceFolder` swaps out an existing folder with the same
  title, so importing twice on one day does not duplicate.
- `recent.json`: `{ version: 1, entries: [{ path, time, source: opened | played, count }],
hidden: [{ key, time }] }`, 300 entries and 500 hidden keys at most, writes debounced 1s,
  flushed on quit. Only paths with a `recentKindOf` are recorded (`FsRequest {op: 'recent'}`,
  the files `open`/`mpv` ops, `MusicRequest {op: 'played'}` for library tracks, home `open`/`mpv`).
- `downloads.json`: `{ version: 1, entries: DownloadEntry[] }` (`id, url, filename, path, mime,
received, total, speed, status, started, ended`, times in epoch ms), newest first, at most 200,
  writes debounced 1s, flushed on quit. Entries that were running at quit load as `interrupted`.
- Theme: `~/.config/quickshell/theme-tokens.json` (version 3) is parsed into `ThemeTokens
{ source, variant, name, vars, base }`. `vars` holds colours (`#AARRGGBB` → rgba) and shadows;
  `base` holds the rest of the ewe look: `shape` (radii, border widths) and `size` (type scale ×
  `accessibility.text_scale`, spacing, controls, icons) as px, `type.css.sans/mono` →
  `--font-sans/--font-mono` (only font-list characters accepted), weights, and `motion`
  (`durFast/Base/Slow ÷ speed` → `--dur-*`, `easing` names → `--ease-out` / `--ease-in-out`,
  `reduceMotion` or `accessibility.reduce_motion` → 1ms). The directory is watched, so an atomic
  rename by ewe-conf is picked up (e2e covers it). Renderers apply `base` whenever ewe tokens
  exist and `vars` only when `theme === 'system'`; `data-theme` follows the ewe variant. The
  window and sidebar background follow ewe `surface-base` in system mode.
- Account: `~/.config/ewe/cloud.json`, identity fields only (display name / login / user, email,
  server). Shown as the avatar initial; no sync yet.

## Renderer conventions

- Solid 1.9. Rail tab rows use `<Index>` so DOM nodes survive state broadcasts.
  `createBrowserStore()` guards against the initial fetch overwriting a newer push.
- `Rail` (`components/Rail.tsx`, props `store, mode: expanded | collapsed | peek,
downloadsActive, editRequest?, renameRequest?, onEditingChange?`), top to bottom:
  - top row: collapse toggle (`settings.update {rail}`; Ctrl+Shift+S, `rail.toggle`), back,
    forward, reload / stop;
  - address field: lock / globe / app glyph, host in `text-primary` and path in `text-muted`, and
    a star (`bookmark.toggle`, filled in `accent-text` when bookmarked). Click or Ctrl+L turns it
    into an input with the url selected and inline host completion from `suggest`; Enter sends
    `tab.navigate {id}`, Escape or blur cancels. With the rail collapsed or in fullscreen, Ctrl+L
    opens the palette with the url instead;
  - pinned tabs as a 4-column grid of favicon tiles (one column when collapsed), the active one
    outlined in the workspace colour; middle-click closes;
  - the workspace header (see the overlay section);
  - the unpinned tabs of the active workspace as list rows (favicon with an accent spinner ring
    while loading, title, mute button when audible or muted, close on hover and on the active
    row; the active row is `surface-raised` with a 3px workspace-colour bar). Click activates,
    middle-click closes, right-click opens the tab menu. Pointer drag reorders (`tab.move` with
    the workspace-relative index, after the pinned group) or, dropped on another workspace dot,
    moves the tab there (`tab.moveToWorkspace`); a drag ends when the button is no longer held
    or capture is lost. "New tab" opens the new-tab palette;
  - footer: workspace dots and "+", then Bookmarks / Downloads (accent dot while downloads run) /
    History sidebar toggles (`.on` while open) and Settings.
    Collapsed (56px) keeps the toggle, pinned and tab favicons, "+", the dots, Downloads and Settings.
- `Palette`: modes url / search / tabs (`t:`) / bookmarks (`b:`), `w:` forces search, a "New
  tab" chip when opened from Ctrl+T, Kbd hints. `b:` lists `rankBookmarks` matches (title prefix
  4, title 2, host prefix 3, host 1.5, url 1; empty query = everything by recency) with the
  folder path in the hint. In url and search modes up to three bookmark rows sit between the go
  row and the history rows; open tabs win over bookmarks, bookmarks win over history, all by url.
  Tab rows of pinned tabs prefix their hint with "Pinned ·".
- `Menu` (`components/Menu.tsx`): items as data, `MenuEntry = { type: 'item', id, label, icon?,
dot?, hint?, danger?, disabled?, items? (submenu), run? } | { type: 'separator' } | { type:
'swatches', id, swatches, selected?, pick }`. Props `items, at: Point, leaving?, onClose`. One
  `MenuPanel` per level, `position: fixed`, measured in `onMount` and placed with `placeMenu`
  (flip to the other side of the pointer, 8px margin) or `placeSubmenu` (right of the row, first
  item aligned, flips left). Submenus render as siblings, never inside the animated parent.
  Keyboard: arrows, Enter/Space, Right opens a submenu or moves along swatches, Left goes back,
  Escape closes everything; hover sets the active row and opens submenus. The root panel takes
  focus; `window` blur closes. `tab-menu.ts` builds the tab items (Reload, Duplicate, Pin / Unpin,
  Mute / Unmute | Move to workspace ▸ (other workspaces with colour dots, New workspace), Copy url
  | Close, Close others, Close to the right; the last two are disabled when only pinned tabs would
  qualify).
- Page CSS order: in a built `app://` page the shared `pages.css` chunk is linked AFTER the
  page's own CSS, so a page rule that overrides `.page` (display, background, padding) must be
  `.page.page-<name>`; with a bare `.page-home` the home page stayed `display: grid`, lost its
  glow, and its card row pushed the page wider than a narrow window. Home is a flex column
  whose `.home` has `margin: auto` (centred when it fits, scrolls when it does not).
- CSS: Ewe tokens only (`--surface-*`, `--text-*`, `--border-*`, `--accent`, `--space-*`,
  `--dur-fast 150ms`, `--dur-base 200ms`, `--dur-slow 250ms`, `--ease-out`), plus browser tokens
  `--rail-width 264px`, `--rail-collapsed-width 56px`, `--page-gap 8px` (mirror `RAIL_WIDTH`,
  `RAIL_COLLAPSED_WIDTH`, `PAGE_GAP`), and `--strip-height 44px` / `--bottom-height 36px`, now
  only the sidebar header and footer heights. Floating surfaces are solid (no glass over pages).
  Keyframes live in `base.css` (`bar-in-down`, `bar-out-up`, `bar-in-up`, `bar-out-down`,
  `ewe-fade-*`, `ewe-slide-*`); reduced motion collapses them to fades.
- Hyprland is a tiling compositor, so there are no window controls in the UI.

## Testing and visual verification

- Unit: `packages/shared` (url, ipc-contract, workspaces, text, menu incl. clamping, shortcuts,
  bookmarks) and `apps/browser/tests/unit` (layout incl. rail peek and toast rects, shortcuts, stores incl.
  bookmarks-store, chrome-bookmarks against `tests/fixtures/chrome-bookmarks.json`, identity,
  protocol, ewe-theme incl. base vars, history incl. `recentEntries`, ewe-account,
  downloads-store, bookmark reorder, sidebar layout, files: places parsing, the file service on a
  temp tree, ranges, argv, the desktop entry, archive parsing and a real bsdtar round trip).
  plus music helpers, titles from file names, home: recent kinds, picking, request validation, the
  xbel parser, snippets, the recent store and the recents service over a temp tree). 186 tests
  (84 shared, 102 browser). Nothing reads
  the owner's real Chrome profile: paths are injected, and the e2e run sets
  `EWE_CHROME_BOOKMARKS` to the fixture.
- Safe: unit tests for site matching (`safe-site`), the save decision (`safe-decide`), form
  detection on happy-dom pages (`safe-forms`), the socket client against a fake daemon
  (`safe-client`), WebAuthn helpers (`safe-webauthn`: the RP ID table incl. public and private
  suffixes, IPs and `localhost`, `clientDataJSON`, option parsing, reply checks), the passkey
  broker against `tests/fake-safed.ts` with real ES256 keys and signatures checked by
  `tests/webauthn-rp.ts` (`safe-passkeys`, also the list placement and when it opens), the
  main-world script with stub classes (`safe-page-script`: object shape, methods, `toJSON`,
  errors, `AbortSignal`, fallbacks), and the shared validators
  (`packages/shared/src/safe.test.ts`). `safe-passkeys-daemon` runs the broker against a real
  sandboxed `ewe-safed` (skipped unless `EWE_SAFED_BIN` and `EWE_SAFE_BIN` are set).
  E2E `tests/e2e/safe-inline.spec.ts` (12 tests, always on) runs the app against the in-process
  fake daemon and a local relying party on `http://localhost:<port>` that verifies every
  attestation and signature in Node: the script is in place before the page's first script,
  save a passkey, `excludeCredentials` → `InvalidStateError`, sign in from the sheet, Cancel and
  abort, Use a security key instead, locked → Unlock → Save, a cross-origin frame, the inline list
  under the field with the focus kept in it (typing filters, ↓ Enter fills, Esc, no match hides),
  Tab opens / script focus and page load do not, and conditional mediation through the list.
  `tests/e2e/safe.spec.ts` (7 tests, skipped unless `EWE_SAFED_BIN` and `EWE_SAFE_BIN` point at
  built ewe-safe binaries) starts a sandboxed daemon (its own runtime, state, data and config
  dirs, a fake `ewe-conf`, `EWE_SAFE_NO_LOGIND`, `EWE_SAFE_KDF_ITERATIONS=2`), two local servers
  on `127.0.0.1` and `localhost` (two origins), and covers: no fill on load, click-to-fill, the
  cross-origin frame, generate + save, update, no prompt for a known login, and locked → Unlock
  Safe (`EWE_SAFE_ASK_CMD`). Both run inside a nested Hyprland (`WAYLAND_DISPLAY` /
  `HYPRLAND_INSTANCE_SIGNATURE` of the nest), never the live session.
- E2E (`smoke.spec.ts`, 26 tests): launches `out/main/index.js` with a temp `EWE_USER_DATA`,
  drives the app through `window.ewe` on the shell page, reads `getState()`, sends keys and mouse
  events through `app.evaluate` + `sendInputEvent`, waits for `loading === false` before sending
  keys (keys are dropped in the first ~200ms of a load). `shellOf` also waits until the shell
  viewport matches the window and has stopped changing, because Hyprland tiles the window about
  a second after launch and coordinates taken before that land outside the overlay. Covers tabs,
  the palette, Ctrl+L into the rail address field, the page card at x 264 / y 8, collapsing to 56px,
  the hover peek and Ctrl+Shift+S, identity, workspaces + history persistence, session restore, the
  tab context menu from a rail row (duplicate, close others, move to a new workspace), the
  workspace dot menu (colour, Rename routed to the rail header, inline rename with Escape, empty
  and 40-character cases, Move tabs here, Remove), tab pinning (`tab.pin` moves the tab first,
  `move` clamps to the group, close others / close to the right keep pinned tabs, a duplicate
  lands unpinned after the group, `pinned` survives a restart), bookmarks (Ctrl+D adds and removes
  with a toast, the rail star toggles, `b:` and plain palette rows find the bookmark, the settings
  Import button reads the fixture twice without duplicating, the rail's bookmarks button opens the
  sidebar and the page keeps 8px before it, folders expand, the row menu deletes and edits, New
  folder, search with the folder path hint, a row click navigates, Ctrl+Shift+B closes and Ctrl+J
  opens downloads, the tree and the open section survive a restart), downloads and history (a
  local http server; two downloads of the same file land as `report.txt` and `report (1).txt` in
  `EWE_DOWNLOADS`, remove and Clear finished, history rows grouped under Today, search, remove),
  the live ewe theme (a temp `XDG_CONFIG_HOME` token file swapped by atomic rename changes
  accent, radius and durations; forcing light keeps the base vars), files (a temp tree: listing,
  new folder + rename, F2, copy/paste into another folder, Delete into `EWE_TRASH_DIR`, Backspace,
  a thumbnail, the raw route without a token is 403, the shell cannot call `fs`, address-bar
  paths, type-ahead filter, hidden files, the image viewer, Compress ▸ zip, the archive dialog and
  Extract here, Open in new tab into the viewer; Downloads → Show in folder selects the file), and the
  folder handler in a temp `XDG_CONFIG_HOME` / `XDG_DATA_HOME`, music (silent tagged mp3s made
  with ffmpeg in `EWE_MUSIC_DIR`: albums, artists, songs, the album hero with its embedded cover,
  playback, the tab title, MPRIS on the bus, Next, Space, search, one music tab), Markdown and
  code in the files viewer (Use / Give back, and the owner's
  real `~/.config/mimeapps.list` is compared before and after), and home (a temp `XDG_DATA_HOME`
  xbel, a tiny PDF rendered by pdf.js, a video frame, a played track, a visited page; filters,
  the viewer and back, `music.play` reusing the music tab, Remove from Recent, type-ahead into the
  search, a path typed into it; the shell is refused `home`, raw without a token is 403).
- Hyprland: `tests/e2e/hyprland.ts` and `scripts/visual.mjs` register a temporary rule
  (`hl.window_rule({ match = { class = '(?i)^(ewe-browser|electron)$' }, workspace = '2 silent' })`)
  through `hyprctl repl` so test windows open on workspace 2 next to the owner's terminal, and
  disable it afterwards. This Hyprland build uses a Lua config: `hyprctl dispatch` takes Lua
  dispatcher expressions, `hyprctl repl '<lua>'` prints a return value, globals persist.
  Never move the real cursor; the owner may be in a game on the other monitor.
  The owner's machine currently has one laptop panel showing another workspace, so workspace 2
  is never visible (hence capturing through Electron). The rule matches class `ewe-browser`,
  so if the owner's own `pnpm dev` app restarts while it is enabled (electron-vite restarts
  main on every `src/main` edit), that window opens on workspace 2 too.
- `scripts/visual.mjs` captures through Electron, never from the screen: `capturePage()` of the
  window and of every visible view, composited in the main process (page views masked to the
  10px card radius) and cropped for the rail, sidebar and toast shots. `grim` used to capture
  screen coordinates, which recorded whatever the owner had on screen whenever workspace 2 was
  not the visible one. Scenes: home (fresh, then with recents seeded through a temp
  `XDG_DATA_HOME` xbel, the search dropdown, the card menu, the Docs filter, light), new-tab
  page, the rail with six tabs (full and a hover crop), the address editor, the Ctrl+D toast,
  the starred address, pinned tiles (and an active one), the tab menu and its Move submenu, a
  second workspace, a workspace dot hover, the workspace menu and inline rename, the collapsed
  rail, the hover peek, the sidebar (bookmarks tree, row menu, search, downloads from a local
  server, paused and cancelled, history), the new-tab palette with `t:` and `b:`, Ctrl+L, thirty
  tabs, the file manager on a generated tree (grid with an empty folder, an AppImage and a zip,
  photos with thumbnails and a video frame, the viewer on an image, the next image and the video,
  the archive dialog, the Compress submenu,
  multi-select, list, entry menu, rename, background menu, path field, the rail's files tab),
  settings, light (rail, tab menu, sidebar, files, peek), dark and the sad page. The script
  launches with `EWE_CHROME_BOOKMARKS` pointing at the fixture and `EWE_DOWNLOADS` at a temp
  directory.
- Do not `pkill -f <pattern>`; it has killed the agent's own shell before. Kill by pid.

## Packaging (an ewe first-party app, like Komble)

- `PKGBUILD` at the repo root: `build()` runs `npx -y pnpm@11.13.0 install --frozen-lockfile`
  (the postinstall fetches castlabs' Electron), `pnpm build`, then `electron-builder --linux`
  with `electron-builder.yml` (target `dir`, `electronDist: node_modules/electron/dist`, so
  the runtime is always castlabs' build with Widevine, never a download of upstream Electron;
  `npmRebuild: false`, there are no native modules). `package()` copies
  `apps/browser/dist/linux-unpacked` to `/usr/lib/ewe-browser`, drops `default_app.asar`,
  clears group write bits, symlinks `/usr/bin/ewe-browser`, and installs
  `ewe-browser.desktop`, the hicolor icons and the license. ~120 MB compressed.
- `chrome-sandbox` is not setuid: Arch allows unprivileged user namespaces; checked on the
  package that renderers run in their own user namespace with seccomp mode 2.
- Versions: tag `vX.Y.Z-beta` → pkgver `X.Y.Zbeta` (the only spelling vercmp sorts below the
  final release); both `package.json` files carry `X.Y.Z-beta`. `release.yml` rewrites `_tag`
  and `pkgver`, archives the checkout as the source and attaches
  `ewe-browser-X.Y.Zbeta-1-x86_64.pkg.tar.zst` to a prerelease.
- In ewe: `ewe-repo`'s `publish` collects that asset, the `ewe` package depends on
  `ewe-browser`, phase 20 installs it on the tarball path, Komble lists it in
  `first_party.rs`, and the desktop seeds `ewe-browser.desktop` as the default browser
  (Helium was replaced; Nemo keeps folders). The wave order is this release first, then ewe,
  then the publish, because the fresh-install gate refuses an `ewe` that depends on a package
  the repo does not carry.
- Desktop entry: `Exec=ewe-browser %U`, `StartupWMClass=ewe-browser`, MIME types for http(s),
  html, xhtml and pdf (never `inode/directory`), and a "New window" action
  (`ewe-browser --new-window`, handled on `second-instance`: a new window, plus any url or
  path arguments opened in it).
- Local test of the package: make a tarball of the working tree named
  `ewe-browser-<pkgver>.tar.gz` with the prefix `ewe-browser-<tag without v>/`, copy the
  PKGBUILD next to it and run `makepkg -d --noconfirm --skipchecksums`. Run the result from an
  extracted copy (`usr/lib/ewe-browser/ewe-browser`) with `EWE_USER_DATA`, never by installing
  it on the owner's machine.

## Code conventions

- TypeScript strict with `exactOptionalPropertyTypes` (write `size?: number | undefined`).
- No comments or JSDoc in source; explain in `docs/` instead.
- Prettier: no semicolons, single quotes, width 100. ESLint strict: prefer `??` and `?.`,
  dot notation, no `[...string]` (use `Intl.Segmenter`), `require-await`.
- Commands and events are added in `ipc-contract.ts` first (type + validator), then handled in
  `WindowController.dispatch`, then used from the UI through `api.send`.
- Constants shared between CSS and TypeScript (`RAIL_WIDTH`, `RAIL_COLLAPSED_WIDTH`, `PAGE_GAP`)
  must be changed in both places.
- Never commit without the owner reviewing the diff. Plan approval is not commit approval.
