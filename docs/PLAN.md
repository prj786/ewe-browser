# ewe browser — build plan and status

Source plan: "Custom Browser — Build Plan" (Oct 12, 2026). Mockup: top tab strip with settings and user
circles on the left, slanted tab dividers, a wide active tab showing title and url that becomes an editor on
click, the strip auto-hiding and reappearing on hover (or always visible via settings), a centered search
pill on the new tab page with `w:` and `t:` prefixes, and downloads / AI icons revealed on hover at the
bottom-left.

## Decisions

- Engine: Electron 44 (Chromium 152), not a Chromium fork.
- Extensions: MV3 only, via electron-chrome-extensions (GPL-3.0 unless licensed — decide before phase 3).
- Shell UI: Solid + plain CSS variables. State lives in main; the shell only renders snapshots.
- Storage: JSON files for session, settings, bookmarks and downloads. History is in SQLite (`history.db`)
  through `node:sqlite`, which is built into Electron 44's Node 24, so there is no native module to
  rebuild (decided 2026-10-15; better-sqlite3 was the earlier plan).
- Tab model (from the mockup): horizontal strip, auto-hidden by default, floating over the page in an overlay view.
- Navigation model: url editing inside the active tab, plus a command palette (`Ctrl+K`, and the new tab page).

## Phase 0 — setup

- [x] Monorepo: `apps/browser` and `packages/shared`
- [x] electron-vite 5 (Vite 7) with HMR for the UI and `--watch` restart for main
- [x] Strict TypeScript 5.9, ESLint 10 (typescript-eslint strict), Prettier, Vitest 5
- [x] Persistent session `persist:default`

## Phase 1 — skeleton

- [x] WindowManager: frameless BrowserWindow, multiple windows
- [x] TabManager: one `WebContentsView` per tab; create, close, activate, reorder; inactive tabs hidden
- [x] Layout engine: main computes tab bounds from the slot the shell reports (`layout.report`)
- [x] Navigation: back, forward, reload, stop, url vs search, title, favicon, loading state
- [x] Typed IPC: commands validated in main, state snapshots broadcast to shell, overlay and app:// pages
- [x] Popups and `window.open`: sized popups become real windows, everything else becomes a tab that keeps `window.opener`
- [x] Identity: `Electron/` and app tokens stripped from the user agent on every webContents, `window.chrome` filled, FedCM disabled (as Flow Browser does)
- [x] Identity follows Chrome stable (2026-10-15): Gmail said "This browser version is no longer supported" because pages saw Chromium 152 while Chrome stable was 155. The user agent, `Sec-CH-UA*` and `navigator.userAgentData` now report the current stable major from the two-week schedule (see AGENTS.md, Process model)
- [x] Pages cannot make dead zones (2026-10-16): a site's `app-region: drag` area swallowed every click and hover (Electron reports page drag regions to the frameless window); the page preload forces `no-drag` as a user-origin `!important` sheet in every non-`app:` frame (see AGENTS.md, Overlay)
- [ ] Safe list orphan (found 2026-10-16, not seen by the owner): `SafeWindow.show()` ends the open list, then returns when `boundsFor` is null (the new field is off screen) without hiding the overlay; the old list stays up at its rect and every close path is a no-op because `this.suggest` is null. Fix: hide the overlay on that return; test with an ArrowDown open on an off-screen field in `safe-inline.spec.ts`
- [x] Shortcuts matched on physical key codes (layout independent): Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+K, Ctrl+Tab, Ctrl+Shift+T, Ctrl+1..9, Alt+arrows, F5, F11, F12
- [x] Crash handling: `render-process-gone` and failed loads show `app://sad` with a reload button
- [x] Session restore from `session.json` (windows, tabs, active tab, bounds); background tabs load lazily on first activation
- [ ] Exit check: sign into Gmail and YouTube, keep 30 tabs open, restart without losing them

Known gap: Electron exposes no API for user-agent client hints, so `navigator.userAgentData.brands` lists
only Chromium (electron/electron#34762). None of the reference browsers spoof it either.

## Phase 2 — UI shell (mockup already applied)

- [x] Tab strip per mockup: settings and user circles, slanted dividers, wide active tab with title + url, click to edit
- [x] Auto-hide strip shown on hover at the top edge, or always visible via settings
- [x] Overlay layer: transparent `WebContentsView` above pages for strip, corner and palette
- [x] Command palette: tabs (`t:`), web search (`w:`), urls; on the new tab page and over any page (Ctrl+K)
- [x] Corner icons at the bottom-left on hover (downloads, AI, history placeholders)
- [x] Ewe design system applied: tokens for both schemes, Geist, Lucide icons, Bar / Launcher / ListRow patterns; settings page on `app://settings`
- [x] Theme follows the ewe desktop: `~/.config/quickshell/theme-tokens.json` (scheme, accent, shadows) is read and watched; Ewe Dark / Ewe Light can be forced
- [x] Edge hover: top edge slides the strip down, bottom edge slides a slim bar up; both slide back when the pointer returns to the page
- [x] New tab opens the palette over the active page (Zen-style); Enter creates the tab, Esc cancels
- [x] Workspaces: named, coloured groups of tabs in the bottom bar; persisted; Ctrl+Shift+PageDown/PageUp
- [x] Account: the avatar shows the ewe account from `~/.config/ewe/cloud.json` (identity only; sync is phase 5)
- [x] Tab activation animates widths; the strip and bottom bar slide in and out
- [x] Tabs fill the strip (one tab = full width, active tab ≥ 240px, inactive ≥ 36px), accent underline instead of a filled active tab, hover grows the underline, sticky "+"
- [x] Edge hover works in tiled, non-fullscreen windows (drag regions removed from the floating layers; leave direction detection)
- [x] Workspace chips: min/max width, middle ellipsis for long names
- [ ] Glance: Ctrl+click a link opens it in a floating page view over the active tab (reuse the overlay layering; one more `WebContentsView` sized by the layout engine)
- [ ] Tab drag and drop: reorder across windows, drag out to a new window (pointer-based drag already exists inside a strip)
- [ ] Split view: the shell reports two page slots and main places two tab views side by side (`layout.report` grows a `slots` list)
- [ ] Import from Chrome: bookmarks, history, open tabs, search engine and settings from the Chrome profile (phase 4 storage first)
- [ ] Animations limited to transform and opacity; verify smoothness with 50 tabs
- [ ] Window controls for non-tiling desktops

## Reported 2026-10-13 — open bugs

1. [x] **Fixed:** the strip has no "+" any more; double-click on empty strip background opens the
       new-tab palette. **"+" collides with the active tab's close button.** When the active tab is last or the strip is
       tight, the sticky "+" sits over the "×". Decision to take: drop the "+" button from the strip.
       New tabs already come from Ctrl+T, the palette's "New tab" chip and the new tab page; a
       double-click on empty strip background can open the palette too. Remove `.strip-new` and
       `STRIP_NEW_BUTTON` from `tabWidths` together.
2. [x] **Fixed:** right-click on a chip opens a workspace menu (Rename, colour swatch row, Move
       tabs here, Remove) and double-click renames inline; the popover and the bottom `expanded`
       mode are gone. New commands `menu.open {kind: 'workspace'}` and `workspace.mergeInto`.
       **Workspace editor feels wrong.** The name and colour popover appearing on right-click or
       double-click is confusing. Replace it with a proper context menu on right-click (Rename, Colour
       as a swatch row, Move tabs here, Remove) and rename inline inside the chip on double-click.
       The menu is the same component as the tab context menu below.
3. [x] **Fixed:** width transition is off by default; `tabAnimation` in settings turns it on for
       the floating strip only (never the shell strip). **Tab width animation on the top bar looks ugly.** Make it opt-in: no `width` transition by
       default, keep the slide in/out of the bars and the underline/colour transitions. If it stays,
       it should only run while the strip is visible and never on the shell strip in `always` mode.

## Next features (in order)

1. [x] **Home page** on `app://home`: opened on first launch when there is no session, and from a home
       icon in the strip corner next to settings. Empty for now; it will host a speed dial, bookmarks,
       a workspace overview and ewe account state. `open.internal` grows a `'home'` page;
       `tabKindOf` gets `'home'`.
2. [x] **Tab context menu** (right-click on a tab, rendered in the overlay so it follows the theme):
       Reload, Duplicate, Mute / Unmute | Move to workspace ▸ (other workspaces with colour dots,
       New workspace), Copy url | Close, Close others, Close to the right. Done with a `menu`
       overlay part covering the window (instead of a strip-expanded mode) so the same path serves
       the floating strip and the always-visible shell strip; the floating strip stays mounted
       under the menu. `Menu` in `components/` (items as data, submenus, swatch rows, keyboard),
       `placeMenu`/`placeSubmenu` in `packages/shared/src/menu.ts`, commands `menu.open`,
       `tab.duplicate`, `tab.moveToWorkspace`, `tab.closeOthers`, `tab.closeRight`, `tab.copyUrl`,
       `nav.reload {id?}`. Moving the active tab follows it into the target workspace. Pin /
       Unpin landed with #3. Deferred: shortcut hints only on the active tab, no toast after
       Copy url.
3. [x] **Tab pinning** like Chrome: `pinned` on `TabState` and `SessionTab` (older sessions load
       as unpinned); pinned tabs sit first in their workspace (`insert()` never places a tab
       inside the pinned group, `move` and the strip's drag clamp to the group), favicon-only at
       a fixed 36px with no close button even when active (the url editor grows from the tab to
       the strip's right edge), excluded from "close others" / "close to the right". Ctrl+W still
       closes a pinned tab, as in Chrome, and Ctrl+Shift+T reopens it pinned. The widths come
       from `tabWidths(width, count, hasActive, pinned)`, which treats pinned tabs as fixed
       chrome with an 8px group gap. Pin / Unpin sits in the tab menu after Duplicate
       (`tab.pin {id, pinned}`, menu only; Ctrl+Shift+P stays the palette). A duplicate of a
       pinned tab lands unpinned right after the group. `t:` palette rows mark pinned tabs. Not
       done: pinned tabs are not sticky when a crowded strip overflows and scrolls the active tab
       into view.
4. [x] **Keyboard movement**: Alt+1..9 select tabs (also Ctrl+1..9; 9 = last), Alt+Shift+1..9 select
       workspace N (9 = last), Ctrl+Alt+Left/Right switch workspaces (Alt+Tab belongs to Hyprland),
       Alt+Home opens the home page. `matchShortcut` is table-driven: `DEFAULT_SHORTCUTS` and the
       pure chord parser/matcher live in `packages/shared/src/shortcuts.ts`, merged with a
       `shortcuts` map in `settings.json` (per action, replaces that action's defaults; invalid
       entries dropped). `app://settings` has a Keyboard shortcuts section: Edit records the next
       chord (Esc cancels, Backspace restores the default), Reset all, inline conflict warning.
       Recording is guarded by the page command `shortcuts.recording {on}` (settings page only),
       which makes main skip shortcut matching for that tab. Deferred: Edit replaces all chords of
       an action with the recorded one (no per-chord add/remove); `Ctrl+Alt+<printable>` is ignored
       as AltGr; conflicts are warned, not blocked (earlier-remapped action wins).
5. [x] **Bookmarks**: `bookmarks.json` (`storage/bookmarks-store.ts`, a root folder of
       `{ id, kind: 'bookmark' | 'folder', title, url | children, added }`, http(s) and `app://`
       only, validated and sanitized on load, debounced atomic writes, broadcast as
       `ewe:bookmarks` with `getBookmarks()` / `onBookmarks` in the API). Commands
       `bookmark.toggle | add | remove | update | folder.create` and `bookmarks.importChrome`
       (settings page only). Ctrl+D (`bookmark` in `DEFAULT_SHORTCUTS`, listed on the settings
       page) toggles the active tab and shows the first toast UI: a new overlay part `toast`
       above the bottom bar slot, auto-hidden after 1.8s, skipped when another part is open. The
       url editor has a star at its right edge (filled in the accent when bookmarked) and a
       bookmarked active tab shows a small star before its title. The bottom bar's bookmark icon
       opens `BookmarksPopover` through `menu.open {kind: 'bookmarks'}`: a dedicated panel
       reusing the `Menu` classes (favicons, host hints, scrolling, cascading folder panels,
       keyboard), click / Ctrl-click / middle-click, a row context menu (Open in new tab, Edit,
       Delete) and inline forms for edit, rename and New folder. The palette has a `b:` mode and
       puts up to three bookmark rows above history in plain queries (open tabs > bookmarks >
       history by url). Chrome import reads `$EWE_CHROME_BOOKMARKS`, then the Chrome and
       Chromium `Default/Bookmarks` files (read-only) into "Imported from Chrome (date)" with
       Bookmarks bar / Other / Mobile folders; a same-day re-import replaces the folder. Whether
       a tab is bookmarked is derived in the renderers from the tree, not stored in `TabState`.
       Deferred: drag to reorder or move between folders (only Edit's folder field through
       `bookmark.update`), favicons are guessed as `origin/favicon.ico` when no open tab has one,
       no bookmarks page, no "open all in folder", no bookmark bar strip, pages cannot edit
       bookmarks yet (only `bookmarks.importChrome` is allowed from `app://settings`).

Later, already planned: glance (Ctrl+click a link into a floating page view), tab drag and drop
across windows, split view, Chrome import for history and settings, downloads and history pages,
account sync with the ewe backend, Chrome extensions (phase 3, licence decision pending).

## All-in-one roadmap (agreed 2026-10-13)

The browser grows into the ewe super app: web, files, media, cloud drives, one theme. Each step is
built, verified and handed to the owner for testing before the next starts.

1. [x] **Right sidebar, downloads, history, full ewe theming** (landed 2026-10-13)
   - Full-height right sidebar (`SidebarController`, its own `WebContentsView` and layer
     `sidebar`) that pushes the page; sections Bookmarks, Downloads, History; resizable from its
     left edge (280–640px, saved), section kept per window across restarts, hidden in HTML
     fullscreen. Bottom bar icons and Ctrl+Shift+B / Ctrl+J / Ctrl+H toggle it.
   - Bookmarks moved out of the tiny popover into a tree: search with folder paths, expand state,
     drag and drop to reorder and move into folders (`bookmark.update {index}`), row menus, Open
     all, inline edit and new-folder forms, Bookmark this tab. The popover is gone.
   - Real downloads: saved to `~/Downloads` without a dialog under unique names, progress, speed,
     time left, pause, resume, cancel, retry, open, show in folder, remove, clear finished,
     `downloads.json`, toasts on start and finish, blank download-only tabs closed.
   - History pane: recent visits by day, search, remove, open in new tab, copy link.
   - Theme: the whole ewe token file now applies (radius, borders, spacing, type scale with text
     scale, fonts, weights, durations with speed, easing, reduced motion), not only colours; the
     window background follows ewe `surface-base`; live update after an atomic rewrite is covered
     by e2e.
   - Known: AI icon stays a disabled placeholder; downloads do not resume across restarts
     (interrupted entries offer Retry); no download drag-out to other apps yet; favicons for
     history rows are guessed from `origin/favicon.ico`.
2. [x] **Chrome that fits ewe** (landed 2026-10-13)
   - Two directions were mocked with the real tokens (`docs/mockups/step2/`: A a left rail, B a
     floating island); the owner chose A, always visible and collapsible.
   - The top strip and the bottom bar are gone. The shell is a 264px rail (nav buttons, an
     in-place address field with the star, pinned tiles, the workspace header, tab rows, workspace
     dots, sidebar buttons, settings) next to the page, which is now a rounded card 8px from the
     edges. Collapsed it is a 56px icon column that peeks over the page on hover; Ctrl+Shift+S or
     the toggle switches, `Settings.rail` remembers it. Fullscreen hides it and the left edge
     peeks it.
   - Tabs drag to reorder or onto a workspace dot to move; workspace rename works from the header,
     a dot or the menu.
   - Removed: `TabStrip`, `BottomBar`, `strip.ts` (`tabWidths`), the `tabStrip` and
     `tabAnimation` settings, the top/bottom edge reveal and the windowed leave detection.
   - Fixed on the way: menus re-place on resize and `placeMenu` clamps into the viewport; the
     palette follows a new `query` while open.
   - Known: only the visible page view is rounded (rounding hidden views left stale shell frames);
     dark favicons (GitHub) are hard to see on dark tiles; background tabs restored lazily show
     their url until first activated.
3. [x] **`app://files`** (landed 2026-10-13)
   - A file manager page: places (XDG dirs, Nextcloud and Google Drive through ewe's own
     `ewe-files` / `ewe-drive` brokers with Connect, GTK bookmarks, removable drives, GVFS mounts,
     rclone mounts, File system, Trash), breadcrumbs and a path field, filter, sort, grid and list,
     thumbnails (reusing Nemo's cache, video frames via ffmpegthumbnailer), multi-select,
     keyboard, inline rename, new folder, cut/copy/paste between tabs, Move to Trash, drag to
     folders and out to other apps, open with the system app, terminal here, live refresh.
   - Address field and palette accept `/path` and `~/path`; Downloads → Show in folder opens it
     here; command-line paths open as tabs; Settings → Files can make ewe browser the folder
     handler (and give it back).
   - Security: only `app://files` gets `fs`; raw files and thumbnails need a per-run token.
   - Follow-up (2026-10-13): image/video/audio viewer overlay with arrows and Open in new tab;
     archives open in a dialog with Extract here; Compress ▸ zip / tar.gz / tar.zst; files open
     through `gio open` (AppImages in komble, zips in Engrampa); AppImage package icon; fixed
     folders losing their glyph after browsing a folder of images.
   - Known: no progress bar for long copies yet (a spinner in the status line); dropping files from
     other apps into the window is not handled; Trash is listed but has no Restore; files open with
     the system app until the viewers of step 4 exist; GVFS Google Drive shows file ids as names
     (that is the FUSE view), the ewe-drive rclone folder does not.
4. [x] **Media and viewers** (landed 2026-10-13)
   - Text, code (highlight.js), Markdown (marked + DOMPurify, preview and source) and PDF
     (Chromium's viewer) in the files viewer, next to images, video and audio.
   - `app://music`: library from the Music folder with tags and covers (music-metadata), Albums /
     Artists / Songs, search, album pages, a player bar with queue, shuffle, repeat, seek and
     volume; Media Session metadata, so playback shows up over MPRIS in ewe's media controls.
   - mpv for videos Chromium cannot play (menu, viewer, and offered on a decode error).
   - Known: no playlists or editing tags; no gapless playback; the library watches nothing
     (Rescan or reopening picks up new files); EPUB and office files still open in their apps.
5. [x] **Broker and ewe plugins** (landed 2026-10-13)
   - Passwords through ewe Passwords (`ewe-pass`): Ctrl+Shift+L or the key in the address field
     opens a picker over the page with the logins that match the site (1Password, Bitwarden or
     pass, whichever ewe uses). Enter focuses the login field and lets ewe-pass type username,
     Tab, password; Ctrl+Enter types the password only; Ctrl+C / Ctrl+Shift+C copy. Secrets go
     from the manager to wtype / wl-copy and never through the browser.
   - Web panels: + in the sidebar keeps the current site there (chat, music, mail), loaded in
     its own view next to bookmarks, downloads and history; up to 12, managed in Settings.
   - Resident process: "Keep running in the background" leaves the browser loaded when the last
     window closes (the next window opens in about 75 ms, session restored); "Start with ewe"
     adds a hidden `--background` entry to ewe startup apps through `ewe-conf`.
   - Known: ewe-pass itself does no form detection or save-on-submit (Safe does, see below);
     ewe's QML plugin panels cannot be hosted (they are Quickshell components), so panels are
     web pages; no tray icon.
6. [x] **Extensions, DRM, sync** (landed 2026-10-13)
   - Chrome extensions through electron-chrome-extensions (GPL-3.0, matching the project) and
     electron-chrome-web-store: an "Add to ewe browser" button under the address field on any
     Web Store extension page (the store's own "Add to Chrome" refuses non-Chrome browsers),
     "Add by link or ID" in Settings, an ewe permission prompt, auto-update, extension buttons
     with badges in the rail, popups inside the window, a menu (Options, Manage, Remove) and an
     Extensions section in Settings. Verified live with uBlock Origin Lite.
   - Widevine DRM through castlabs Electron for Content Security (`v44.5.1+wvcus`): the CDM
     downloads on first launch and EME `com.widevine.alpha` works. The builds are VMP-signed for
     development only; Netflix and similar services need production VMP signing through castlabs
     EVS (a free account) before they play in high quality, or at all.
   - Sync with Nextcloud: bookmarks, history and portable settings (search engine, theme, rail,
     shortcuts, panels, how long history is kept) in `ewe/browser/` on the ewe Nextcloud
     account, through `ewe-cloud`'s app password. A three-way merge per record keeps edits from
     both machines; a new machine adopts the account's settings. Every 10 minutes, 20 seconds
     after a change, and with Sync now. Since 2026-10-15 history deletions travel as clear
     records and each machine shares its open tabs (see "History and real sync" below).
   - Known: no page context menu yet, so extension context-menu items are not shown; extension
     popups are measured after load (Electron 44 sends no preferred-size events for views);
     `chrome.action.openPopup` still uses the library's own window; sync does not cover
     passwords (they stay in the password manager) or extensions themselves.

## Reported 2026-10-14 — the rail

1. [x] **"The sidebar toggler flips back" / "hovering in windowed mode shows nothing".** Neither
       reproduced with synthetic input or with a real pointer in a nested Hyprland at scale 1.8;
       the owner's answers explained it: they reach for the SCREEN edge, which in a tiled window
       is Hyprland's gap outside the browser (Electron never sees the pointer there), and the
       56px icon column's own hover peek looked like the collapse undoing itself. Collapsed now
       hides the rail completely in a normal window, as in fullscreen: the page card takes the
       width, and the rail slides in when the pointer reaches the window's left edge or leaves
       through it on the way to the screen edge (page edge, the shell's 8px gap strip, a left
       mouseLeave); the peek stays while the pointer is out in the gap; hiding has a 500ms grace
       so it cannot flip straight back. Verified with a real pointer in a nested Hyprland (sweep
       into the gap, peek, use, leave, sweep again, pin with the peek's toggle) and e2e.
2. [x] Stale `*.json.<pid>.<n>.tmp` files piled up in the profile when a process died between the
       temp write and the rename (every `pnpm dev` restart); each store now removes its own
       leftovers from other pids when it loads, once they are a minute old (so a command-line
       read can never delete a running browser's in-flight write).

## Home, ewe package, CLI (agreed 2026-10-14)

1. [x] **Home screen** (landed 2026-10-14, waiting for the owner's review)
   - `app://home` rebuilt: greeting, a large search pill (palette logic, results drop down only
     while typing), folder shortcuts (XDG dirs, Nextcloud / Google Drive with an offline dot, GTK
     bookmarks, devices; balanced rows), and Recent: five cards mixing the newest document,
     video, song and site first, with All / Docs / Videos / Music / Web filters.
   - Recents come from files opened in ewe browser (viewer, default app, mpv), songs played in
     Music, GTK's `recently-used.xbel` (Nemo, mpv, file choosers), finished downloads and
     history (search pages skipped, one page per site). Stored in `recent.json`; "Remove from
     Recent" hides an item until it is used again.
   - Cards: PDF first pages through pdf.js (no poppler needed), video frames, album covers,
     Markdown/text snippets, site favicons. PDFs, text, video and audio open in the files viewer,
     songs play in the one Music tab (`music.play`), Office files open in their app. The page
     updates live through `ewe:home-changed`.
   - Fixed on the way: GTK bookmarks with a trailing slash had no label and duplicated the
     Nextcloud place; `scripts/visual.mjs` captured the screen with grim and recorded other
     windows whenever workspace 2 was not visible, so it now captures the app's own views.
   - Known: no page thumbnails for websites (favicons only); office documents show a paper glyph
     unless a freedesktop thumbnail exists; images are not part of Recent.
2. [x] **ewe package** (released 2026-10-14: ewe browser 0.1.0-beta, ewe 0.26.0-beta, Komble
       0.20.2-beta, then the ewe-repo publish)
   - ewe browser is packaged like Komble: root `PKGBUILD`, `packaging/` (desktop entry with a
     New window action, the globe icon), `scripts/gen-icons.sh`, `release.yml` (tag → makepkg
     → GitHub release) and `ci.yml`. electron-builder lays out castlabs' runtime + `app.asar`;
     the package is ~120 MB. Built and run from the package: home loads, extensions start,
     renderers are sandboxed through user namespaces (no setuid helper), `--new-window` with a
     url opens a second window in the running instance.
   - It replaces Helium as ewe's browser (owner's decision): ewe-repo publishes it and asserts
     the dependency; the `ewe` package depends on it; phase 20 installs it; `ewe-setup` and
     phase 60 seed it as the default browser; Super+B falls back to it; `$BROWSER` points at
     it; the dock's default pins name it; `warmup.sh` warms it; Helium's theming hook runs only
     while Helium is installed; Komble lists it as first-party. Nemo keeps folders.
   - Fixed on the way: get.sh installed months-old stable releases (or fell back to a source
     build) because it asked GitHub for "Latest", which skips the `-beta` releases every app
     ships; it now takes the newest release, like the `[ewe]` repo and Komble. The app's
     folder handler writes its own hidden `ewe-browser-folders.desktop`, so it can never shadow
     the packaged `ewe-browser.desktop`.
   - One wave across six repos (ewe-browser#1, ewe#51, ewe-repo#2, komble-arch#13,
     prj786.github.io#5, ewe-map#8). CI here needed a 4 GB Node heap for type-aware ESLint
     and `bsdtar` on the Ubuntu runner. The repo went public that day: ewe-repo's publish
     reads releases with its own token and Komble and get.sh fetch them anonymously, so the
     first publish could not see a private repo's release and its fresh-install gate failed.
   - Still open: `ewe-auth`/`ewe-cloud` name Helium as a fallback after `xdg-open` (both are
     being rewritten); existing machines keep Helium as default until changed in Settings.
3. [x] **CLI** (landed 2026-10-14, waiting for the owner's review): `ewe-browser <verb>` with
       one JSON object per call and exit 0 (rule 5), reference in `docs/CLI.md`.
   - 31 tools: read (status, tabs, history, bookmarks, downloads, recent, find across all of
     them plus music, music, places, ls, locate, page with `--text`), desktop (open, search,
     play, reveal, home, focus, tab activate/reload/mute/pin/reopen, bookmark add) and change
     (tab close, bookmark remove). `call <tool> '<json>'` runs any of them; `commands` prints
     every tool with a JSON Schema, a Companion tier and its argv; acting replies carry `undo`
     argv lists; every tool whose reply can hold text from websites or from disk is marked
     `untrusted`.
   - Transport: a 0600 Unix socket per profile in `$XDG_RUNTIME_DIR` (the folder must be the
     user's own and not writable by others), JSON lines. Closed browser: read verbs answer from
     the profile on disk, bookmark edits write the file, acting verbs start the browser and
     wait for the socket. `/usr/bin/ewe-browser` is now a sh wrapper that runs verbs in
     Electron's Node mode (a fraction of a second, no display needed) and everything else as
     before.
   - Matches what the Companion's plan named: `search` and `play` (with its YouTube Music
     fallback). Its registry is still hand-written; `commands` is what it can be generated
     from.
   - Next: website page and vault notes for the CLI with the next release; a `downloads`
     notification hint for the Companion; pause/next go through MPRIS (playerctl), not here.

## Safe, ewe's password manager (2026-10-14)

1. [x] **Safe in the browser** (built 2026-10-14 on `feat/safe`, approved and merged 2026-10-15;
       ewe-safe RFC-008, its `docs/PROTOCOL.md` v1). Built in, not a store extension: the main process
       talks to `ewe-safed` over its socket and fills the page's own fields.
   - A key in login, new-password and one-time-code fields; a click (a first click into the field,
     the key, or ArrowDown in an empty field) lists the Safe logins for that frame's own origin in
     the overlay. Nothing is filled until a login is picked; never on page load.
   - Strict site matching: the same host first, then the same registrable domain (public-suffix
     list incl. private suffixes such as `github.io`); an https login never goes to an http page;
     ports must match. A cross-origin frame only ever gets its own origin's logins.
   - New-password fields offer "Use a strong password" (`ewe-safe generate`, 20 characters) and
     fill the confirm field too. One-time-code fields fill the matched login's code.
   - After a sign-in: "Save to Safe?" (Save · Never for this site · Not now) or "Update the
     password in Safe?"; nothing when the same login is already saved. The captured password lives
     only in main-process memory until decided (two minutes at most).
   - Locked: "Unlock Safe" runs `ewe-safe unlock --ask`, then the list comes back.
   - Settings → ewe: Fill from Safe, Offer to save logins, the never-save sites.
   - Ctrl+Shift+L keeps going through ewe Passwords (`ewe-pass`), whose provider `ewe` fills from
     Safe too. (Replaced in wave 2: Ctrl+Shift+L opens Safe itself, see below.)
2. [x] **Like 1Password: suggestions in the field, passkeys** (built 2026-10-15 on `feat/safe`,
       ewe-safe `docs/TRIO.md` §B1; approved and merged 2026-10-15).
   - When you click or Tab into a login, email, password or code field, a small list drops right
     under it: passkeys first (when the site asks for one), then the logins for that site (icon,
     title, username), then Open Safe / Use a strong password / Unlock Safe. The focus stays in the
     field: typing filters, ↑ ↓ move, Enter fills, Esc closes. It follows scroll, resize and zoom
     and closes on navigation, on blur and on a click elsewhere. Script focus and page load never
     open it. The browser draws it (the overlay), so the page can't read or restyle it.
   - Setting: _Show suggestions when a field gets focus_ (on). Off = only the key and ArrowDown.
   - Passkeys: a site can save a passkey in Safe ("Save a passkey for github.com in Safe?") and
     sign in with it ("Sign in to github.com with a passkey", or straight from the list when the
     site uses conditional mediation). Main checks the origin and the relying party, builds the
     client data itself and asks Safe to sign (`passkey-create` / `passkey-get`, Safe's ES256 key
     in the KeePassXC format). _Use a security key instead_ gives the request to Chromium's own
     WebAuthn. Setting: _Passkeys_ (on).
   - Safety: the list and the sheet ignore a click until they have stood still for half a second
     and the mouse has moved; Enter in the sheet works only after you chose with the arrow keys;
     the browser re-checks the page's origin when you click Save or pick a passkey; names the site
     sends are cleaned before they are shown.
   - Tested: a local test site that checks every attestation and signature, a fake Safe with real
     keys, and the real `ewe-safed` from `feat/passkeys` (unit test and the older e2e).
   - Known: in a frame from another site the list opens at the pointer, not under the field, and
     does not move when the outer page scrolls; passkeys in a frame from another site are refused
     (`NotAllowedError`); _Use a security key instead_ reaches Chromium's own WebAuthn, which in
     Electron has no window of its own (untested with a real key here); a passkey saved while the
     site already gave up (abort or timeout after Save) stays in Safe; like Chrome, a page may
     open the passkey sheet without a click on the page; Safe always reports "user verified"
     (unlocked Safe + a click, as 1Password does); no passkey row on logins
     without a waiting request; not tried on real sites (github.com, google.com) yet; a
     password-only second step of a two-step sign-in is saved without its username; no identities
     or cards; the one-time-code fill is unit-tested only (`ewe-safe add` cannot store a code
     yet).
3. [ ] **Sign-ups always ask; cards and addresses** (built 2026-10-18 on
       `feat/safe-signup-cards`, ewe-safe `docs/SYSTEM.md` §5, staged for the owner's review; lands
       after wave 2 and is rebased onto it). The owner: "When I register somewhere it should ask me
       if I want to save the data as a new login."
   - Why it often did not ask: a locked Safe dropped the captured login without a word; a
     sign-up whose username was not seen was treated as "update the only login of this site" (or
     nothing, when that password was saved for another account), even counting logins of other
     subdomains; a username typed on an earlier step was lost; app-style sign-ups (no `<form>`, a
     clickable `<div>`) were never seen; a strong password from Safe was never offered without a
     seen submit; and a fast form navigation could beat the capture.
   - Now: "Save this login to Safe?" with the username and the site, Save / Not now / Never for
     this site. A sign-up saves a **new** login unless this site already has a login with that
     username (then "Update the password in Safe?"). Locked: the same prompt says "Safe is
     locked. Unlock it to save." and _Unlock and save_ unlocks first. The username comes from
     the form (username, then email, then the field before the password), else from an earlier
     step in the same tab (5 minutes, kept in the browser's main process). Sign-ups are seen
     through Enter, a button-like click, the password field leaving the page, or an in-page
     navigation within 10 s after typing. A strong password from Safe is offered on the tab's
     next page or when the tab closes, even without a submit.
   - Cards and addresses: card and address fields get the Safe list (cards: brand, •••• last 4,
     expiry; addresses: name and street). A pick fills that form section in that frame only
     (payment frames such as Stripe fill their own field). Cards ask for the password again
     first (`ewe-safe confirm --ask`, once per 5 minutes in Safe), and fill only on https pages
     (or `localhost`). Settings → ewe: _Fill addresses_, _Fill cards_ (on).
   - Tested: unit (form detection, decisions, fills, the service and wallet against the fake
     Safe), e2e against the fake Safe (12 tests), and the real daemon from stream C
     (`.wt/safe-cards`, cards and addresses with `confirm_cards` off, plus the existing 7).
   - Not verified: the confirm window itself (`ewe-safe confirm --ask` belongs to stream L, not
     built with cards yet), real sites (Google's and Microsoft's two-step sign-ups, Stripe,
     Adyen), inputs inside shadow roots (not seen), and `127.0.0.1` pages, which never get
     cards although browsers call them secure.

## History and real sync (2026-10-15, branch `feat/history`, approved and merged 2026-10-15)

The owner asked for "a browser with real syncing and history management" (TRIO.md, B2).

- [x] **`app://history`**: every visit, one row per page and day, grouped by day (Today,
      Yesterday, then dates). Search (full text on title and url, `site:host` works too),
      a site filter (click the host on a row), select with checkboxes (Shift for a range, the day
      header selects the day), Delete or the row menu, _Delete everything from this site_ (the
      host without `www.` and its subdomains; can also delete that site's cookies and site
      data), _Keep history for_ forever / 1 year / 90 days / 30 days, and **Clear browsing
      data** for the last hour / 24 hours / 7 days / 4 weeks / all time. Endless scroll.
- [x] Opening it: Ctrl+Shift+H (new shortcut `history`; Ctrl+H stays the History sidebar, like
      Firefox), _Show all history_ in the sidebar's History footer, the palette (type "hist"),
      Settings → Browsing (_Open history_, _Clear data…_). One history tab: opening it again
      switches to it.
- [x] **Clear browsing data, honestly.** History and the downloads list work for every range.
      Cookies and site data and cached files are **all time only**: Electron 44's
      `session.clearData`, `clearStorageData` and `clearCache` take no time range, and a cookie
      has no creation time in Electron's API. The dialog disables those two for other ranges and
      says why. "Cookies and site data" clears both sessions (tabs and web panels) and keeps the
      data of installed extensions (`excludeOrigins`). The downloads list never deletes files.
- [x] **SQLite.** `history.db` (WAL) with `urls`, `visits`, `clears` and an FTS5 index (trigram
      tokenizer, so any 3+ letters match inside words; shorter words use LIKE). The in-memory map
      for the palette, the url completion and the sidebar stays, so those paths did not get
      slower. On first start `history.json` is imported once and renamed to
      `history.json.bak` (entry by entry: malformed entries are skipped and counted in the log).
      A broken database is moved aside (`history.db.broken-<time>`) and a new one starts, filled
      again from `history.json.bak` when that is all there is. Checked: `node:sqlite` loads in Electron 44.5.1 (castlabs) as Node, in the
      sandboxed main process and in the packaged app (electron-builder, asar), SQLite 3.53.4,
      FTS5 and trigram present. The migration of 20 000 pages takes about 2 s once.
- [x] **Deletions sync.** Every delete is a _clear record_ `{id, at, from, to, url?, site?}`
      (a per-page delete is a record with `url`, a site delete one with `site`, a range clear one
      with only times). The records travel in `ewe/browser/history.json` next to `data`; each
      machine applies the records it has not seen to its own visits, then filters base, local and
      remote by all records before the three-way merge. A visit after the delete time wins (it
      is new), a visit before it loses. Records live 180 days (5000 at most; an all-time clear
      replaces older ones). 0.1.0-beta ignores the extra field and drops it when it writes; the
      next new client puts it back.
- [x] **One timeline.** Deletes compare times written by different machines, so they assume
      the clocks agree. To make that true, every WebDAV answer's `Date` header is sampled (the
      median of the last 7, at the request's midpoint) and, when this computer is more than
      5 s off, the browser stamps visits, clear records and `savedAt` with the server's time
      instead of its own (the offset is kept in `sync/status.json` for the next start; more
      than a day off is not trusted). The sync status warns when this computer is more than
      5 minutes off, and when another machine's `savedAt` is more than 5 minutes away from the
      server's `Last-Modified` of the file it wrote (that machine runs an old version or has
      no server time). Settings shows the warning under the sync status, the history page
      under its summary.
- [x] **Expired records still win.** A clear record is dropped after 180 days, so a machine
      that was away longer could bring a deleted page back. Sync therefore never uploads a page
      whose last visit is older than 180 days unless the server already has it: if the
      server had it before (it is in this machine's last merged state) and no longer does, it
      is deleted here too; if it was never synced, it stays on this computer only. The cost:
      pages older than 180 days that were never synced do not reach other machines.
- [x] If the server copy of a file is gone (deleted by hand, a new account), the next sync
      uploads everything again instead of reading the gap as "everything was deleted".
- [x] _Keep history for_ is a synced setting, so both machines keep the same window; old visits
      are deleted on start, every day, and when the setting changes.
- [x] **Tabs from your other computers.** Each machine writes `ewe/browser/tabs-<id>.json`
      (windows → workspaces → tabs: url, title, pinned; web pages only, 500 at most) with
      `savedAt`, when its tabs changed or every 6 hours, and reads the others' (PROPFIND, ETags so
      unchanged files are not downloaded again; files older than 30 days are ignored). The
      history page shows them under _Other computers_; the palette offers them (`t:` and plain
      queries, hint "machine · url"). The label is the host name (`$EWE_SYNC_MACHINE` for
      tests), like ewe-sync's machine records; the file id is 16 hex characters of a salted
      SHA-256 of `/etc/machine-id` and the profile path (ewe-conf's convention: the raw id is
      never published; two machines or two profiles never share a file even with the same
      host name), or a random id kept in `<userData>/sync/machine-id` when there is no
      machine-id. After its first write a machine deletes its own old `tabs-<host name>.json`
      (only a file without `id` and with its own label). Two machines with the same name both
      show, with the first 4 characters of the id after the name.
- [x] `<userData>/sync/status.json` mirrors the sync state (`state`, `lastSync`, `error`,
      `warning`, `account`, `machine`, `machineId`, `clockOffset`, `updatedAt`) for ewe-sync to
      read.

Known / open:

- **Rule 6 ("nothing else has a sync button").** The browser still has its own sync switch and
  _Sync now_ in Settings. ewe-sync cannot start a browser sync today (its Sync now pushes
  `ewe.conf` and runs folder pairs only), so the button stays until it can. Proposal: a
  _Browser_ row in ewe-sync that reads `~/.config/ewe-browser/sync/status.json` and runs
  `ewe-browser sync` (a new verb for the command line in `rail-and-cli`, answering with the
  status JSON); then the browser's own _Sync now_ goes and its Sync section becomes
  "Managed in ewe Sync" with the status line.
- The command line reads history through `HistoryStore`: from the running browser, or, when it
  is closed, read-only from `history.db` (`loadSnapshot`, which never migrates or prunes, so a
  read cannot move `history.json` away under an older browser). It should get `history delete`
  verbs later (TRIO.md).
- Sync still uploads the whole `history.json` (up to 20 000 pages) when it changed. Splitting it
  by month and conditional GETs would cut traffic; not done yet.
- At most 20 000 pages are kept ("Forever" means no time limit, the oldest pages still go
  first) and 200 000 visits.
- Rows from another machine carry only its newest visit per page, so a page visited on several
  days there shows on the last of those days here.
- Not verified on two real machines or against the owner's real Nextcloud (only the mock WebDAV
  server in unit and e2e tests).

## Bottom bar (asked 2026-10-17, 0.3.0-beta)

The owner: workspaces and the tool buttons (bookmarks, downloads, …) do not fit in the rail's
small foot. Done on `feat/bottom-bar`:

1. [x] A thin (32px) full-width bar under the page card, always visible except in fullscreen
       (also with the rail hidden): workspace chips with names on the left (click, double-click
       renames inline, right-click opens the workspace menu with rename and colour, a dragged
       rail tab drops onto a chip), `+` at their end; Bookmarks / Downloads / History, Music,
       Files and Settings at the right end. The sidebar and the rail peek end above it.
2. [x] `+` creates "Workspace N" (N = count + 1, next free colour) and opens it on Home; any
       empty workspace now falls back to Home instead of the new-tab page.
3. [x] The rail lost its workspace header and foot: pinned tiles sit where the extension row
       was (under the address field), and the extension buttons sit at the old foot.
4. [ ] Not done: dropping a tab from the rail PEEK onto a chip (the peek is the overlay
       document; its tab menu has Move to workspace).

## Wave 2, browser details (asked 2026-10-18, branch `feat/input-menus`)

The owner: finger gestures, more shortcuts, right-click menus on websites, and no third-party
passwords (only Safe fills inputs). Built on `feat/input-menus`, released in 0.4.0-beta:

1. [x] **Two-finger swipe** back and forward: the page preload watches `wheel` in the main frame,
       an arrow at the page edge fills as the swipe nears the threshold (160 px), letting go past
       it navigates, before it does nothing; only with history that way, never when something
       under the pointer can still scroll sideways or the page handles the wheel itself.
       Settings → Browsing → _Swipe to go back_ (on). Four fingers switch the browser's own
       workspaces through `ewe-browser workspace next|prev` (ewe's Hyprland config, stream E).
2. [x] **Mouse side buttons**: in pages Chromium already goes back and forward (and lets a page
       cancel it); on the rail, the bottom bar, the overlay and the sidebar they now do too.
3. [x] **Find in page**: Ctrl+F opens a find bar at the page's top right with a match count;
       Enter / F3 / Ctrl+G next, Shift+Enter / Shift+F3 / Ctrl+Shift+G previous, Esc closes and
       keeps the match selected; prefilled with the selection. Files, Music, History and the
       sidebar keep their own Ctrl+F.
4. [x] **New shortcuts** (Settings → Keyboard shortcuts, all rebindable): Ctrl+F, Ctrl+G / F3,
       Ctrl+Shift+G / Shift+F3, Alt+Shift+N new workspace, Alt+Shift+R rename it, Alt+Shift+Left
       / Right workspaces, Ctrl+Alt+Shift+Left / Right move the tab to the previous / next
       workspace, Alt+Shift+H home, Ctrl+, settings, Ctrl+P print, Ctrl+U page source,
       Alt+Shift+D duplicate, Alt+Shift+P pin, Ctrl+M mute, Alt+Shift+C copy the address,
       Ctrl+Shift+A search open tabs, Alt+Shift+M music. None changed from the plan: none clashes
       with Chromium's keys or ewe's Hyprland binds (all Super), Ctrl+Shift+A is Chrome's own tab
       search, Ctrl+M is Firefox's mute.
5. [x] **Right-click on web pages**: links (new tab, new workspace, new window, save, copy),
       images (open, save, copy, copy address), video and audio (play/pause, mute, loop,
       controls, open, save, copy address), selected text (copy, search, Go to), fields
       (spelling, Fill from Safe / Use a strong password, undo, redo, cut, copy, paste, paste as
       plain text, select all), the page (back, forward, reload, bookmark, save page, print,
       view source) and always Inspect. The menu key and Shift+F10 open it too.
6. [x] **Safe only**: Ctrl+Shift+L, the key in the address field and the right-click menu open
       Safe's list for the focused field (or the page's first login field) and fill through
       Safe; the ewe-pass route and its picker are gone. Password-manager extensions (a
       best-effort list of 36 checked Web Store ids) cannot be added, and an installed one is
       refused before it loads, with a toast.
7. [x] **Review fixes** (same day): the new keys a web app may use (Ctrl+F, Ctrl+U, Ctrl+P,
       Ctrl+M, Ctrl+G, Ctrl+, and the Alt+Shift ones) go to the page first and only act when the
       page did not handle them; a page menu closes when its page navigates and refuses stale
       actions; "Use a strong password" is armed for the clicked frame only; the swipe arrow is
       dropped on navigation, a crash, a tab switch or a second without movement.

Known / open:

- The swipe is tested with synthetic wheel events only; how it feels on a real touchpad
  (threshold, kinetic scrolling after the fingers lift, a mouse with a tilt wheel) is unverified.
- Print opens the system dialog (`webContents.print`), untested by hand; tests stub it.
- Extension context-menu items (`chrome.contextMenus`) are not in the page menu yet.
- A turned-off password-manager extension stays in `<userData>/Extensions` and is not listed in
  Settings; there is no way to delete it from the UI.
- The find bar closes when another overlay part opens (a menu, the palette, Safe's list).

## Wave 2 — privacy, site search, command line (stream B, 2026-10-18, `feat/privacy-site-search`)

The owner asked for DNS and security settings, and for Shaun to reach further into the browser
("search men's shoes on zara" → Zara's own results). Built on `feat/privacy-site-search`,
released in 0.4.0-beta:

1. [x] **Command line (contract 1)**: `search --site`, `site`, `workspaces`, `workspace
 activate|next|prev|create|rename|remove`, `back`, `forward`, `download open|show`,
       `open --workspace`. `workspace next` answers in ~45 ms (the 4-finger swipe runs it).
2. [x] **Site search**: history-learned templates (keeps the owner's locale), OpenSearch
       descriptors found on visited pages (`site-search.json`), a 66-site table with `{cc}` from
       the time zone and `{lang}` from `LANG`, a `site:` filter fallback, `@site words` in the
       palette and the address field. Every table template was requested once on 2026-10-18 (curl
       with a Chrome user agent, then Electron for the 403s); Mango (404 for `/ge/en/`), Shein,
       Unsplash, Yelp and Merriam-Webster (bot walls) were dropped; Adidas, Best Buy, eBay, H&M,
       Uniqlo, Newegg, Amazon, AliExpress, GitLab, Stack Overflow and Facebook stay unverified
       (bot walls or sign-in, also in a fresh Electron profile).
3. [x] **Settings → Privacy and security**: Secure DNS (Off by default, Automatic, Cloudflare,
       Quad9, Mullvad, AdGuard, NextDNS, Custom; live), HTTPS-Only (off by default; interstitial
       with "Continue to the http site" for the session), third-party cookies blocked through
       Chromium's own `ForceThirdPartyCookieBlockingEnabled` (applies after a restart), Global
       Privacy Control (`Sec-GPC: 1` and `navigator.globalPrivacyControl`, on by default).
4. [x] **Site permissions**: camera, microphone, location, notifications, clipboard, MIDI, local
       network, window placement and idle detection ask through a prompt card (merged requests,
       clickjacking guard, no focus steal), decisions in `permissions.json`, the check handler and
       `navigator.permissions.query` agree, a list in Settings, and a site info panel from the
       address field's lock (permissions, clear site data, site settings). Video calls and web
       notifications work now; they were silently denied before.
5. [ ] Not done: screen sharing (`getDisplayMedia` needs `setDisplayMediaRequestHandler` and the
       portal picker), external protocol links (`openExternal`, still denied), USB/HID/serial
       choosers, Storage Access API prompts (denied, so an embed that asks for its cookies under
       third-party blocking gets none), per-site HTTPS-Only exceptions beyond the session,
       `navigator.globalPrivacyControl` in workers, a fast fallback when port 443 hangs, and
       a lock / site info entry while the rail is hidden.

## Phase 3 — Chrome extensions

- [x] License decision: GPL-3.0 for the whole project
- [x] One `ElectronChromeExtensions` per session with tab/window callbacks wired to TabManager
- [x] Own action buttons in the rail instead of `<browser-action-list>`; Web Store installs
- [ ] electron-chrome-context-menu (needs a page context menu first)
- [x] MV3 service workers (needs `app.enableSandbox()`, see AGENTS.md)
- [x] Extensions in Settings, install prompt
- [ ] Pin/unpin and reorder extension buttons
- [ ] Test set: uBlock Origin Lite, Bitwarden, Dark Reader, React DevTools, a tab manager

## Phase 4 — browser essentials

- [x] History: visits with frecency, palette suggestions, inline host completion in the url editor
- [x] History page (`app://history`), full-text search, SQLite (2026-10-15, see below)
- [x] Downloads in the sidebar (see roadmap step 1)
- [x] History list in the sidebar (search, remove, Show all history)
- [x] Permissions prompts (wave 2, see above)
- [ ] Find in page, zoom per site, print
- [ ] Private windows, profiles (user circle), default-browser registration
- [ ] Reopen-closed-tab history across restarts

## Phase 5 — accounts, polish, packaging

- [ ] Google sign-in regression test
- [ ] `chrome.identity.launchWebAuthFlow`
- [ ] Own account and sync backend
- [ ] Tab discarding, startup under 1 s, memory budget
- [ ] AppImage + Nix, NSIS, DMG, electron-updater
