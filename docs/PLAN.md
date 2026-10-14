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
- Storage: JSON files for session and settings now; SQLite (better-sqlite3) arrives with history in phase 4.
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
   - Known: no automatic form detection or save-on-submit (ewe-pass reads, it does not write);
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
     shortcuts, panels) in `ewe/browser/` on the ewe Nextcloud account, through `ewe-cloud`'s
     app password. A three-way merge per record keeps edits from both machines and carries
     deletions; a new machine adopts the account's settings. Every 10 minutes, 20 seconds after
     a change, and with Sync now.
   - Known: no page context menu yet, so extension context-menu items are not shown; extension
     popups are measured after load (Electron 44 sends no preferred-size events for views);
     `chrome.action.openPopup` still uses the library's own window; sync does not cover open
     tabs, passwords (they stay in the password manager) or extensions themselves.

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
2. [ ] **ewe package**: ship ewe browser as a default ewe package like Komble and Cast.
3. [ ] **CLI**: a scriptable `ewe-browser` command (open folders and files, search, list tabs,
       recents and history) with JSON output, for the ewe companion. `RecentsService` and
       `HomeService` are the first pieces it reuses.

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

- [x] History (JSON for now): visits with frecency, palette suggestions, inline host completion in the url editor
- [ ] History page, full-text search and a move to SQLite when it grows
- [x] Downloads in the sidebar (see roadmap step 1)
- [x] History list in the sidebar (search, remove); a full history page is still open
- [ ] Permissions prompts, find in page, zoom per site, print
- [ ] Private windows, profiles (user circle), default-browser registration
- [ ] Reopen-closed-tab history across restarts

## Phase 5 — accounts, polish, packaging

- [ ] Google sign-in regression test
- [ ] `chrome.identity.launchWebAuthFlow`
- [ ] Own account and sync backend
- [ ] Tab discarding, startup under 1 s, memory budget
- [ ] AppImage + Nix, NSIS, DMG, electron-updater
