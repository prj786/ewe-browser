# ewe browser

An all-in-one app for the ewe Linux desktop (Hyprland, Wayland): a Chromium-engine web browser,
file manager, media viewer and music player in one window, styled and themed live by ewe.

Built on Electron 44 (Chromium 152) with a thin Solid UI. The main process owns every tab as a
`WebContentsView`; the visible chrome is a left tab rail, a floating overlay (palette, menus,
toasts) and a right sidebar.

## What it does

- **Browser**: a tab rail with workspaces, pinned tabs and drag to reorder; a command palette
  (`t:` tabs, `b:` bookmarks, `w:` web search); bookmarks, downloads and history in the
  sidebar; Chrome bookmark import; session restore with lazy tabs; remappable shortcuts;
  right-click menus on web pages (links, images, video, selected text, fields, the page);
  find in page; two-finger touchpad swipes and the mouse side buttons for back and forward.
- **Files** (`app://files`): a file manager that can replace Nemo, with places, Nextcloud and
  Google Drive through ewe's brokers, GVFS and removable drives, thumbnails, copy, move, trash,
  drag and drop, compress and extract, and "open folders with ewe browser".
- **Viewers**: images, video, audio, text, highlighted code, Markdown and PDF in an overlay that
  steps through the folder; mpv for videos Chromium cannot play.
- **Music** (`app://music`): a library from your Music folder with albums, artists, songs,
  search, a queue, shuffle and repeat, and MPRIS, so ewe's media controls and media keys work.
- **ewe integration**: the look follows ewe's theme tokens live (colours, radius, fonts,
  motion); passwords fill only from Safe, ewe's password manager (known password-manager
  extensions, a best-effort list of store ids, are refused and turned off); web panels in the
  sidebar; an optional resident process and
  "start with ewe" for instant windows.

- **Extensions, DRM, sync**: Chrome Web Store extensions (an "Add to ewe browser" button on
  store pages), Widevine DRM through castlabs Electron, and sync of bookmarks, history and
  settings with your ewe Nextcloud account.

## Command line

`ewe-browser <verb>` prints one JSON object and exits 0, for scripts, Komble and the ewe
Companion. `ewe-browser help` lists the verbs; the reference is [docs/CLI.md](docs/CLI.md).

```
ewe-browser open ~/Documents         # a folder in the file manager, a url, a file or a search
ewe-browser search sheep breeds      # web search with the engine from Settings
ewe-browser find invoice             # tabs, bookmarks, history, recent files and music at once
ewe-browser locate report --in ~/Documents
ewe-browser tabs | jq '.tabs[].title'
ewe-browser play black sheep         # the best match from your music library
ewe-browser commands                 # every tool with a JSON Schema, for an assistant
```

Read verbs answer from the profile on disk while the browser is closed; acting verbs start it.

## Shortcuts

| Keys                                 | Action                          |
| ------------------------------------ | ------------------------------- |
| Ctrl+T / Ctrl+W / Ctrl+Shift+T       | new, close, reopen tab          |
| Ctrl+L                               | edit the address                |
| Ctrl+K                               | command palette                 |
| Ctrl+D                               | bookmark or unbookmark the page |
| Ctrl+Shift+B / Ctrl+J / Ctrl+H       | bookmarks, downloads, history   |
| Ctrl+Shift+E                         | files                           |
| Ctrl+Shift+L                         | fill from Safe                  |
| Ctrl+F / Ctrl+G / Ctrl+Shift+G       | find in page, next, previous    |
| Ctrl+P / Ctrl+U / Ctrl+,             | print, page source, settings    |
| Ctrl+M / Ctrl+Shift+A                | mute the tab, search open tabs  |
| Alt+Shift+N / Alt+Shift+R            | new workspace, rename it        |
| Alt+Shift+Left / Alt+Shift+Right     | previous, next workspace        |
| Ctrl+Alt+Shift+Left / Right          | move the tab to that workspace  |
| Alt+Shift+D / P / C                  | duplicate, pin, copy address    |
| Alt+Shift+H / Alt+Shift+M            | home, music                     |
| Ctrl+Shift+S                         | collapse or expand the rail     |
| Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+1-9 | switch tabs                     |
| Alt+Shift+1-9                        | switch workspaces               |
| Alt+Left / Alt+Right / Ctrl+R        | back, forward, reload           |
| F11 / F12                            | fullscreen, devtools            |

Every shortcut can be changed in Settings.

## Develop

Needs pnpm 11 and a Wayland session (Electron does not run headless here).

```
pnpm install
pnpm dev          # electron-vite with HMR for the UI and restart for main
pnpm typecheck
pnpm lint
pnpm test         # unit tests (vitest)
pnpm build
pnpm test:e2e     # end-to-end tests (playwright, needs a build)
```

`EWE_USER_DATA=<dir>` runs against a throwaway profile. `cd apps/browser && node
scripts/visual.mjs <dir>` writes screenshots of every scene from the built app.

## Install

ewe browser ships with ewe: the `ewe` package depends on it, so `sudo pacman -S ewe` (or
`sudo pacman -Syu` on an ewe machine) installs it from the `[ewe]` repository. On its own:
`sudo pacman -S ewe-browser`, or the `.pkg.tar.zst` from a GitHub release with
`sudo pacman -U`. It is the desktop's default browser on new installs; an existing machine
switches in ewe Settings → Default apps.

## Layout

```
apps/browser/          the Electron app: src/main, src/preload, src/ui (rail, overlay, sidebar),
                       src/pages (newtab, home, settings, sad, files, music), tests, scripts
packages/shared/       the typed IPC contract, models and pure helpers used by every layer
PKGBUILD, packaging/   the Arch package (desktop entry, icon, the /usr/bin wrapper); release.yml
docs/CLI.md            the command line reference
docs/PLAN.md           roadmap and open bugs
docs/DESIGN.md         how the Ewe design system maps onto the browser
AGENTS.md              architecture map (start here)
```

## Status

All six roadmap steps of `docs/PLAN.md` are done: the sidebar, the ewe-styled chrome, files,
media and viewers, the ewe integration, and extensions, DRM and sync. Open bugs and next ideas
live in `docs/PLAN.md`.

## License

GPL-3.0-only, see [LICENSE](LICENSE). The bundled Geist and Geist Mono fonts are under the SIL
Open Font License (`apps/browser/src/ui/fonts/Geist-OFL.txt`).
