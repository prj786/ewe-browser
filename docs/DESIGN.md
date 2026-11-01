# Design

The browser shell follows the Ewe design system (`ewe/design/system`, version 3). This page maps each
surface to the Ewe component it follows and records what the system did not cover.

## Foundations

- Tokens: `apps/browser/src/ui/styles/tokens.css`, the Ewe tokens the browser uses, both schemes in one
  list through `light-dark()`. Ewe Dark is the default. `html[data-theme='light' | 'dark']` forces a
  scheme; without the attribute ("System") the scheme follows `prefers-color-scheme`, falling back to
  dark.
- Fonts: Geist and Geist Mono variable fonts with their OFL license in `src/ui/fonts/`, declared in
  `styles/fonts.css`. Noto Sans Georgian is in the stack as the system fallback.
- Icons: Lucide paths copied into `components/Icon.tsx` (24px grid, 2px stroke, round caps and
  joins), sized with `icon-*` tokens in CSS.
- Shared primitives in `styles/components.css`: `.iconbtn` (IconButton), `.avatar` (Avatar),
  `.btn` (Button), `.kbd` and `.kbd-combo` (Kbd), `[data-tooltip]` (Tooltip), `.glass` (Glass role
  remap).
- Motion: `--dur-fast` 150ms, `--dur-base` 200ms, `--dur-slow` 250ms, `--ease-out` (OutCubic),
  `--ease-in-out` (InOutCubic). Only `transform` and `opacity` animate. Reduced motion turns every
  animation into a fade at `dur-fast`.
- Focus: a 1px `focus-ring` outline 1px outside every control on `:focus-visible`; text fields turn
  their own border `focus-ring` instead.
- Native window background: `surface-base` (Ewe Dark `neutral-950` #0b0a08, Ewe Light `neutral-100`
  #f4f2ee).
- Desktop scheme: with the theme setting on "Ewe desktop", main reads `~/.config/quickshell/theme-tokens.json`
  (ewe-theme's v3 output), converts its colours and shadows to CSS custom properties and pushes them to
  every renderer, which sets them on `:root`; the file is watched, so `ewe-theme` changes apply live.
  "Ewe Dark" and "Ewe Light" use the built-in tokens instead.

## Surfaces

| Surface                      | Follows                                                                                                        | Tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab rail (shell)             | Bar turned vertical; ListRow rows; Tile for pinned tabs                                                        | 264px on `surface-base`, `space-s` inset; address field `control-xl` on `surface-sunken` with `rounded` radius; pinned tiles `control-xl` on `surface-raised` right under it; rows `control-lg`, `secondary` radius, hover `glass-hover`, active `surface-raised` + `border-subtle` inset + `shadow-sm` + 3px workspace-colour bar; extension buttons at the foot after a `border-subtle` hairline                                                                               |
| Bottom bar (shell)           | Bar, flattened to one thin row; Segmented-like workspace chips; ghost sm IconButtons                           | full window width, `--bottom-bar-height` 32px on `surface-base`, `page-gap` side inset; workspace chips `control-sm`, `secondary` radius, colour dot `space-s` (55% opacity, full when active or hovered), name `font-size-s` in `text-muted`, active chip `surface-raised` + `shadow-sm` in `text-primary`; drop target `accent-subtle` with an `accent` inset ring; actions `iconbtn--sm`, the open sidebar section on `surface-raised` in `accent-text`; hidden in fullscreen |
| Remote workspace chip        | Bar chip with a leading glyph                                                                                  | the bar chip plus the `monitor` glyph at `icon-xs` in `text-muted` (`text-secondary` when active) before the name; "via <computer>" in `font-size-xs` `text-muted` after it when the workspace is not named after the computer                                                                                                                                                                                                                                                   |
| Rail, hidden and peek        | Bar; peek floats like a panel                                                                                  | collapsed hides the rail; the left window edge (12px, 24px on leave, plus the 8px gap strip) slides the full rail over the page (`shadow-float` plus a `scrim` spread, `dur-base` in, `dur-fast` out)                                                                                                                                                                                                                                                                            |
| Page card                    | Window content card                                                                                            | the page view sits `PAGE_GAP` 8px from the top and right window edges and the rail, directly on the bottom bar, corners rounded with `rounded` through `setBorderRadius`; square in fullscreen                                                                                                                                                                                                                                                                                   |
| Settings and profile         | IconButton (round, lg) and Avatar                                                                              | `surface-hover`, `surface-pressed`, `text-secondary` → `text-primary`                                                                                                                                                                                                                                                                                                                                                                                                            |
| Palette                      | Launcher, SearchField (xl / 2xl), ListRow, Kbd                                                                 | `surface-overlay`, `border-subtle`, `rounded`, `shadow-float`; rows `control-xl` with a `control-md` icon well on `surface-sunken`; footer legend on `surface-base`                                                                                                                                                                                                                                                                                                              |
| New tab page                 | Launcher on `surface-base`                                                                                     | plain `surface-base`; the large palette alone                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Home page                    | Launcher hero, Tile grid for folders, a card row, Segmented filter                                             | `surface-base` under a 10% `accent` radial glow; search pill `control-2xl + space-s` on `surface-raised`, `shadow-float`, focus `focus-ring` border plus a 3px 16% `accent` ring; folder wells `control-2xl` on `surface-raised`, glyph `accent-text`, 2px hover lift; 4:3 card previews, `rounded`, 4px lift and `shadow-float` on hover; meta glyphs from status tokens                                                                                                        |
| Settings page                | SettingsPage, SectionHeader (overline), ListRow with icon tile, Select                                         | list well `surface-raised`, rows with `control-lg` tiles, select trigger `surface-sunken` + `border-strong`                                                                                                                                                                                                                                                                                                                                                                      |
| Sad tab page                 | EmptyState (page) with a secondary Button                                                                      | `surface-hover` icon circle, `circle-alert`, `rotate-cw`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Context menu (overlay)       | Menu, floating like a panel; ListRow rows; Kbd-style hints                                                     | `surface-overlay`, `border-subtle`, `rounded`, `shadow-float`, `space-xs` inset; rows `control-md` with an `icon-md` slot, `surface-hover` when active, `text-disabled`, `danger` + `danger-subtle`; mono `text-muted` shortcut hints; slides down at `dur-base`, fades out at `dur-fast`                                                                                                                                                                                        |
| File manager (`app://files`) | Panel (places as ListRows in a well), Toolbar, Breadcrumb, SearchField, Tile grid / ListRow table, Status line | places on `surface-raised` with overline groups; active place `surface-selected` + `shadow-sm` + glyph in `accent-text`; crumbs and filter on `surface-sunken`; tiles 112px min, 72×64 icon well, folder glyph in `accent-text` with an accent-tinted fill, kind colours from status tokens (info, success, warning, danger); selection `accent-subtle`; cut and hidden items at half opacity; notices as a pill like the toast                                                  |
| Music (`app://music`)        | Panel nav (like the file manager), Tile grid of covers, ListRow table, a Bar-like player footer                | covers `primary` radius with a hue gradient fallback seeded by the album name; the current track in `accent-text` with an `audio-lines` glyph; play button a round `accent` control; sliders filled with `accent` over `surface-sunken`                                                                                                                                                                                                                                          |
| Viewer overlay               | Lightbox (no system counterpart)                                                                               | near-black scrim from `black`, white-ish controls from the neutral ramp; text and code on a `surface-raised` card with a sticky line gutter; highlight colours from status tokens                                                                                                                                                                                                                                                                                                |
| Find bar (overlay)           | SearchField in a floating panel, ghost sm IconButtons                                                          | `panel-sm` × `control-2xl` on `surface-overlay`, `border-subtle`, `rounded`, `shadow-float`, `find-pad` from the page card's top right corner; field `control-lg` on `surface-sunken`, `focus-ring` border when focused; count mono `font-size-s` in `text-muted`; no match turns the border and count `danger`; slides down at `dur-base`                                                                                                                                       |
| Swipe arrow (overlay)        | a round IconButton, no system counterpart                                                                      | `control-2xl` disc on `surface-overlay`, `shadow-float`, arrow `text-secondary`; a ring fills clockwise in `accent` over `border-subtle` as the swipe nears the threshold while the disc slides in by up to `space-lg` and grows from 80%; at the threshold it fills `accent` with the arrow in `on-accent`                                                                                                                                                                      |
| Page context menu            | Menu, as the tab menu                                                                                          | the Context menu tokens; groups (link, image or media, selection, field, page) split by hairlines, Inspect always last; `check` glyph for Loop / Show controls when on; mono `text-muted` shortcut hints                                                                                                                                                                                                                                                                         |
| Extension buttons and popups | toolbar icon buttons; popups like a menu surface                                                               | `control-md` buttons at the rail foot, `secondary` radius, hover `surface-raised`; badge pill in the extension's colour or `accent`; popups keep their own page look but get the page radius and sit 6px under the button, or above it when there is no room below (always, at the rail foot)                                                                                                                                                                                    |
| Install prompt               | the palette as a confirmation dialog                                                                           | 48px icon well in `surface-sunken`, title `font-size-lg`, permissions as a muted list, Cancel ghost and Add primary; “Add to ewe browser” is an `accent` button above the extension buttons                                                                                                                                                                                                                                                                                      |
| Web panels                   | Segmented header items after a hairline divider                                                                | favicon-only segments, + to add; the panel page fills the sidebar under the header, 6px clear of the resize grip                                                                                                                                                                                                                                                                                                                                                                 |
| History (`app://history`)    | SettingsPage head and wells, SearchField, ListRow lists by day, Menu, a dialog                                 | settings head and `.list` wells; search `control-lg` on `surface-sunken`, sticky; day overlines with a select-all box; rows `control-lg` (mono `text-muted` time, favicon, title, host filter button), selected `accent-subtle`; dialogs `surface-overlay` on `scrim`; danger buttons `danger` on `danger-subtle`; "All time only" badge in `warning`                                                                                                                            |
| Right sidebar                | Panel (`panel-sm`) with a Segmented header, SearchField, ListRow trees and lists                               | `surface-raised`, `border-subtle` on the left; segmented `surface-sunken` with the active segment on `surface-overlay`; rows `control-lg`; download rows with a `control-lg` file well and a 4px progress bar in `accent`                                                                                                                                                                                                                                                        |
| Toast (overlay)              | Pill-shaped panel                                                                                              | `control-lg` tall, `fully-rounded`, `surface-overlay`, `border-subtle`, `shadow-float`, `font-weight-medium`, star glyph in `accent-text`; slides up at `dur-base`, fades out at `dur-fast`; shown 1.8s                                                                                                                                                                                                                                                                          |
| Bookmark star                | ghost sm IconButton inside the Text field                                                                      | `text-muted` outline; filled `accent-text` when bookmarked; an `icon-xs`-sized filled star in `accent-text` before a bookmarked active tab's title                                                                                                                                                                                                                                                                                                                               |

Synced folders in the file manager (2026-10-31) reuse the place row and the Badge idea: an
`icon-xs` state glyph after a synced place's label and on a synced folder's icon well
(`text-muted` synced, `accent-text` syncing and turning, `warning` conflict, `danger` error,
`text-disabled` pending or offline), and a `control-md` pill chip in the toolbar on
`surface-sunken` (`accent-subtle`, `warning-subtle` or `danger-subtle` by state) that names the
state in words.

## Not covered by the system, and what we chose

- Tab rail (chosen 2026-10-13 over a floating island, mockups in `docs/mockups/step2/`): ewe's
  own surfaces are vertical lists (launcher, quick settings, panels), so tabs became ListRow rows
  in a 264px rail instead of a horizontal strip. The rail is the window's base layer, not a
  floating panel, so it stays on `surface-base` and the page is the raised element: a card 8px
  from every edge with the `rounded` radius. Collapsed (2026-10-14), the rail is hidden entirely,
  like Zen's compact mode: the page card takes the full width and the full rail peeks over it
  when the pointer reaches or leaves through the window's left edge, so the page never jumps.
  The 56px icon column it replaced looked like the rail "flipping back" whenever its peek
  opened, and the owner reaches for the screen edge, not for icons.
- Address field in the rail: Arc and Zen put it at the top of the sidebar; here it is a
  `control-xl` field with the host in `text-primary` and the path in `text-muted`, so the domain
  reads first. It edits in place; the palette stays the place for search and tab switching.
- Workspaces and tools, bottom bar (2026-10-17, the owner's call): the dots at the foot of the
  rail and the overline above the tabs could not show names, and the sidebar buttons, music, files
  and settings did not fit next to them in 264px. They moved to a thin bar across the whole window
  under the page card (the page keeps `PAGE_GAP` above it): named chips on the left (the Segmented
  idiom, the active one raised on `surface-raised`) with a + that opens a new "Workspace N" on Home,
  and the tool buttons on the right. The bar stays when the rail is hidden, so workspaces and
  tools are always one click away; the sidebar and the rail peek end above it. A tab dragged from
  the rail onto a chip moves to that workspace. The rail keeps tabs only: pinned tiles took the
  extension row under the address field, and extensions took the old foot.
- Draggable regions: a `-webkit-app-region: drag` area swallows every mouse event in a windowed
  frameless window on Linux before it reaches any web contents (Electron skips that check only in
  fullscreen). The rail is `no-drag` and there is no drag region; Hyprland tiles the window.
- Browser layout tokens, added next to the Ewe tokens: `--rail-width`,
  `--page-gap`, `--bottom-bar-height` (mirror `RAIL_WIDTH`, `PAGE_GAP`, `BOTTOM_BAR_HEIGHT` in
  `packages/shared/src/models.ts`), `--strip-height` and `--bottom-height` (now the sidebar header
  and footer), `--tooltip-delay` 500ms, `--menu-width` 220px (minimum width of a context menu;
  eight `icon-lg` swatches fit in a row), `--suggest-pad` 12px (shadow room around Safe's inline
  list; mirrors `SUGGEST_PAD` in `main/safe/window.ts`), `--find-pad` 12px (shadow room around
  the find bar; mirrors `FIND_PAD` in `main/layout.ts`) and `--swipe-box` 96px (the swipe
  arrow's overlay rect; mirrors `SWIPE_BOX`).
- Page context menu (2026-10-18): the system has no page menu, so it reuses the tab menu's
  Menu surface and keyboard. The order follows Chrome (link, then image or media, then the
  selection, then the field; the page items only when nothing else was hit) so muscle memory
  carries over, and Inspect is always the last row because the owner develops in it. Toggles
  (Loop, Show controls) show a `check` glyph instead of a checkbox column.
- Find bar (2026-10-18): Chrome's place (the page's top right), drawn as a small floating panel
  rather than a strip, so the page never moves. The count sits inside the panel in mono, and a
  query with no match turns the field border and the count `danger` instead of showing a
  message.
- Swipe arrow (2026-10-18): macOS and Chrome show an arrow that follows the fingers; ours is a
  disc at the page edge that slides in and fills a ring as the swipe nears the threshold, so the
  user sees when letting go will navigate. Only `transform` and `opacity` animate.
- Safe's inline list (2026-10-15): the system has no autofill dropdown. It is a Menu surface
  (`surface-overlay`, `border-subtle`, `rounded`, `shadow-float`, slides down at `dur-base`)
  dropped 4px under the field, as wide as the field (280–420px), with ListRow-style rows
  (`control-xl` min height, a `control-md` icon well on `surface-sunken`, title in `text-primary`,
  username in `text-muted` at `font-size-s`, active row `surface-hover`). Logins show the site's
  favicon; passkeys a Lucide `fingerprint` in `accent-text`; the footer actions use plain glyphs
  after a hairline. It never takes focus, so the field keeps its caret and its own focus ring.
- Passkey sheet: the Install prompt's dialog (the palette card at the top third of the window,
  `panel-md` wide) with a `fingerprint` well, the account in a `surface-sunken` box or the
  passkeys as rows, and actions _Use a security key instead_ (ghost, Lucide `usb`), Cancel
  (ghost) and the primary Save / Sign in / Unlock Safe.
- Permission prompt (2026-10-18): the system has no permission dialog. It is the Safe save
  prompt's card (the palette surface, `surface-overlay`, `rounded`, `shadow-float`, slides down at
  `dur-base`) at the page's top left, next to the address field it is about, never taking focus:
  "<host> wants to" with the host in `text-primary` semibold, one row per ask with a
  `control-md` well on `surface-sunken` and a Lucide glyph in `accent-text` (camera, mic,
  map-pin, bell, clipboard, music, network, monitor, moon), the location note in `text-muted`
  `font-size-s`, and Block (ghost) / Allow (primary) after an × for Not now. `--suggest-pad`
  gives the shadow room.
- Site info (2026-10-18): a Menu-like panel (`panel-sm` wide) dropped under the lock: a header
  well (`shield-check` in `accent-text` on `surface-sunken` for https, `triangle-alert` on
  `warning-subtle` in `warning` for http), the host in semibold and the state in `text-muted`,
  one detail line, an overline "Permissions" after a hairline, rows with a three-way Segmented
  control (`surface-sunken` track, the chosen segment on `surface-overlay` with `shadow-sm`,
  Allow in `success`, Block in `danger`) and a footer with Clear site data (ghost, `trash-2`)
  and Site settings (secondary). The address field's lock is now a ghost `control-sm` button;
  http pages show `lock-open` in `warning`.
- HTTPS-Only interstitial: the sad page's EmptyState with a `lock-open` circle on
  `warning-subtle`, a sentence on what continuing means, Go back (secondary) and Continue to the
  http site (ghost), so the safe choice is the stronger button.
- Context menus: the system has no menu placement rule. Menus open with their top-left corner at
  the pointer and flip to the other side of it when they would leave the window, keeping an 8px
  margin (`placeMenu`); a submenu opens to the right of its row with the first item aligned to the
  row and flips to the left when there is no room (`placeSubmenu`). Closing tabs is not styled as
  `danger` (a closed tab can be reopened); the style is reserved for destructive workspace actions.
- Pinned tabs: Chrome's pinned tabs are the model, drawn as Arc-style favicon tiles right under
  the address field (four per row). A pinned tile has no close control;
  closing goes through the menu, Ctrl+W or a middle click.
- No glass over pages: Glass is specified for the bar and dock over a blurred wallpaper, and the
  overlay cannot blur the page beneath it, so an 80% fill let page content bleed through the strip.
  Floating surfaces are solid, as the system prescribes for panels that sit over windows. `.glass`
  stays in `components.css` for a future bar-opacity setting over blur-capable content.
- Favicons that fail to load fall back to the `globe` glyph (`components/Favicon.tsx`) in the rail,
  the sidebar and the palette.
- Tooltips in the rail use the native `title` tooltip: a drawn tooltip next to the rail would be
  covered by the page view.
- Palette selection: the brief asked for `surface-selected`, but on Ewe Light it equals
  `surface-overlay` (both `neutral-0`) and would be invisible. Rows use `surface-hover`, as the
  Launcher card specifies.
- Palette backdrop: the Launcher has no scrim, so the full-window overlay stays transparent and only
  catches the click outside.
- Selects keep the native `<select>` popup for behavior; only the trigger is styled.
- Toast placement: the system has no toast. The confirmation sits at the bottom centre of the page
  card (`TOAST_WIDTH` 360 × `TOAST_HEIGHT` 56 overlay rect, 16px above its bottom edge). It never
  appears while a peek or menu is open; there the star changing is the feedback.
- Home (2026-10-14): the owner asked for a minimal, fancy start page that is also the place to
  reach folders, videos, music and documents. The search is the hero (a pill one step larger than
  the palette's `2xl` field), folders are Tile wells, and Recent is one row of five cards so the
  page never scrolls on a laptop panel. Previews carry the kind (a real PDF page on a paper sheet,
  a video frame with a play chip, the album cover over its own blur, a site favicon on a white tile
  over its blur); colour stays in the previews and the chrome stays neutral. Meta-line glyphs use
  status tokens like the file manager (pdf `danger`, documents and video `info`, sheets and audio
  `success`, slides `warning`, web `accent-text`). Site favicons sit on white in both schemes
  because most are drawn for white (GitHub's black mark vanished on a dark tile). The only motion
  is a staggered `ewe-slide-up` on load and the hover lift.
- History page (2026-10-15): Chrome's history page is the model (one row per page and day, a
  search on top, checkboxes for many), drawn with the Settings page's head and wells so internal
  pages look alike. Checkboxes and the remove button appear on hover and stay while something is
  selected, so the list reads as a plain list. The system has no dialog, so confirmations use
  the palette's surface (`surface-overlay`, `rounded`, `shadow-float`) over a `scrim`. Danger
  buttons follow the Menu's danger rows (`danger` text on `danger-subtle`) and fill on hover.
  Clear browsing data keeps options it cannot do for a range visible but disabled, with an
  "All time only" badge and one sentence why, rather than hiding them. Tabs from other computers
  sit in a well per machine with the workspace names as overlines and their colour dots.
- File manager tiles: Nemo's icon grid is the reference, drawn with Lucide glyphs instead of an
  icon theme so the page follows ewe tokens; kinds are told apart by glyph and a status-token
  colour, and real thumbnails replace the glyph when one exists. Selection uses `accent-subtle`
  (the ListRow "selected" state) rather than a filled accent, so names stay readable.
