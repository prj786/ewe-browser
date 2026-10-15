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

| Surface                      | Follows                                                                                                        | Tokens                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab rail (shell)             | Bar turned vertical; ListRow rows; Tile for pinned tabs; Segmented-like workspace dots                         | 264px on `surface-base`, `space-s` inset; address field `control-xl` on `surface-sunken` with `rounded` radius; rows `control-lg`, `secondary` radius, hover `glass-hover`, active `surface-raised` + `border-subtle` inset + `shadow-sm` + 3px workspace-colour bar; pinned tiles `control-xl` on `surface-raised`; workspace header as an overline in `text-muted`                                                            |
| Rail, collapsed and peek     | Bar, icon-only; peek floats like a panel                                                                       | 56px icon rail; hovering it 250ms slides the full rail over the page in the overlay (`shadow-float` plus a `scrim` spread, `dur-base` in, `dur-fast` out)                                                                                                                                                                                                                                                                       |
| Page card                    | Window content card                                                                                            | the page view sits `PAGE_GAP` 8px from the window edges and the rail, corners rounded with `rounded` through `setBorderRadius`; square in fullscreen                                                                                                                                                                                                                                                                            |
| Settings and profile         | IconButton (round, lg) and Avatar                                                                              | `surface-hover`, `surface-pressed`, `text-secondary` → `text-primary`                                                                                                                                                                                                                                                                                                                                                           |
| Palette                      | Launcher, SearchField (xl / 2xl), ListRow, Kbd                                                                 | `surface-overlay`, `border-subtle`, `rounded`, `shadow-float`; rows `control-xl` with a `control-md` icon well on `surface-sunken`; footer legend on `surface-base`                                                                                                                                                                                                                                                             |
| New tab page                 | Launcher on `surface-base`                                                                                     | plain `surface-base`; the large palette alone                                                                                                                                                                                                                                                                                                                                                                                   |
| Home page                    | Launcher hero, Tile grid for folders, a card row, Segmented filter                                             | `surface-base` under a 10% `accent` radial glow; search pill `control-2xl + space-s` on `surface-raised`, `shadow-float`, focus `focus-ring` border plus a 3px 16% `accent` ring; folder wells `control-2xl` on `surface-raised`, glyph `accent-text`, 2px hover lift; 4:3 card previews, `rounded`, 4px lift and `shadow-float` on hover; meta glyphs from status tokens                                                       |
| Settings page                | SettingsPage, SectionHeader (overline), ListRow with icon tile, Select                                         | list well `surface-raised`, rows with `control-lg` tiles, select trigger `surface-sunken` + `border-strong`                                                                                                                                                                                                                                                                                                                     |
| Sad tab page                 | EmptyState (page) with a secondary Button                                                                      | `surface-hover` icon circle, `circle-alert`, `rotate-cw`                                                                                                                                                                                                                                                                                                                                                                        |
| Context menu (overlay)       | Menu, floating like a panel; ListRow rows; Kbd-style hints                                                     | `surface-overlay`, `border-subtle`, `rounded`, `shadow-float`, `space-xs` inset; rows `control-md` with an `icon-md` slot, `surface-hover` when active, `text-disabled`, `danger` + `danger-subtle`; mono `text-muted` shortcut hints; slides down at `dur-base`, fades out at `dur-fast`                                                                                                                                       |
| File manager (`app://files`) | Panel (places as ListRows in a well), Toolbar, Breadcrumb, SearchField, Tile grid / ListRow table, Status line | places on `surface-raised` with overline groups; active place `surface-selected` + `shadow-sm` + glyph in `accent-text`; crumbs and filter on `surface-sunken`; tiles 112px min, 72×64 icon well, folder glyph in `accent-text` with an accent-tinted fill, kind colours from status tokens (info, success, warning, danger); selection `accent-subtle`; cut and hidden items at half opacity; notices as a pill like the toast |
| Music (`app://music`)        | Panel nav (like the file manager), Tile grid of covers, ListRow table, a Bar-like player footer                | covers `primary` radius with a hue gradient fallback seeded by the album name; the current track in `accent-text` with an `audio-lines` glyph; play button a round `accent` control; sliders filled with `accent` over `surface-sunken`                                                                                                                                                                                         |
| Viewer overlay               | Lightbox (no system counterpart)                                                                               | near-black scrim from `black`, white-ish controls from the neutral ramp; text and code on a `surface-raised` card with a sticky line gutter; highlight colours from status tokens                                                                                                                                                                                                                                               |
| Password picker              | the palette (Spotlight-like overlay) with a host chip                                                          | key glyph in `accent-text`; rows in a `primary`-radius well; copy actions fade in on the selected row; errors with the `danger` glyph and the hint as muted text                                                                                                                                                                                                                                                                |
| Extension buttons and popups | toolbar icon buttons; popups like a menu surface                                                               | `control-md` buttons, `secondary` radius, hover `surface-raised`; badge pill in the extension's colour or `accent`; popups keep their own page look but get the page radius and sit 6px under the button                                                                                                                                                                                                                        |
| Install prompt               | the palette as a confirmation dialog                                                                           | 48px icon well in `surface-sunken`, title `font-size-lg`, permissions as a muted list, Cancel ghost and Add primary; “Add to ewe browser” is an `accent` button under the address field                                                                                                                                                                                                                                         |
| Web panels                   | Segmented header items after a hairline divider                                                                | favicon-only segments, + to add; the panel page fills the sidebar under the header, 6px clear of the resize grip                                                                                                                                                                                                                                                                                                                |
| History (`app://history`)    | SettingsPage head and wells, SearchField, ListRow lists by day, Menu, a dialog                                 | settings head and `.list` wells; search `control-lg` on `surface-sunken`, sticky; day overlines with a select-all box; rows `control-lg` (mono `text-muted` time, favicon, title, host filter button), selected `accent-subtle`; dialogs `surface-overlay` on `scrim`; danger buttons `danger` on `danger-subtle`; "All time only" badge in `warning`                                                                           |
| Right sidebar                | Panel (`panel-sm`) with a Segmented header, SearchField, ListRow trees and lists                               | `surface-raised`, `border-subtle` on the left; segmented `surface-sunken` with the active segment on `surface-overlay`; rows `control-lg`; download rows with a `control-lg` file well and a 4px progress bar in `accent`                                                                                                                                                                                                       |
| Toast (overlay)              | Pill-shaped panel                                                                                              | `control-lg` tall, `fully-rounded`, `surface-overlay`, `border-subtle`, `shadow-float`, `font-weight-medium`, star glyph in `accent-text`; slides up at `dur-base`, fades out at `dur-fast`; shown 1.8s                                                                                                                                                                                                                         |
| Bookmark star                | ghost sm IconButton inside the Text field                                                                      | `text-muted` outline; filled `accent-text` when bookmarked; an `icon-xs`-sized filled star in `accent-text` before a bookmarked active tab's title                                                                                                                                                                                                                                                                              |

## Not covered by the system, and what we chose

- Tab rail (chosen 2026-10-13 over a floating island, mockups in `docs/mockups/step2/`): ewe's
  own surfaces are vertical lists (launcher, quick settings, panels), so tabs became ListRow rows
  in a 264px rail instead of a horizontal strip. The rail is the window's base layer, not a
  floating panel, so it stays on `surface-base` and the page is the raised element: a card 8px
  from every edge with the `rounded` radius. Collapsed, the rail is a 56px icon column and the full
  rail peeks over the page on hover rather than pushing it, so the page never jumps.
- Address field in the rail: Arc and Zen put it at the top of the sidebar; here it is a
  `control-xl` field with the host in `text-primary` and the path in `text-muted`, so the domain
  reads first. It edits in place; the palette stays the place for search and tab switching.
- Workspaces: the bottom bar's chips became coloured dots at the foot of the rail (the Segmented
  idiom: the active one raised on `surface-raised`), and the active workspace's name is the overline
  above its tabs. A tab dragged onto a dot moves to that workspace.
- Draggable regions: a `-webkit-app-region: drag` area swallows every mouse event in a windowed
  frameless window on Linux before it reaches any web contents (Electron skips that check only in
  fullscreen). The rail is `no-drag` and there is no drag region; Hyprland tiles the window.
- Browser layout tokens, added next to the Ewe tokens: `--rail-width`, `--rail-collapsed-width`,
  `--page-gap` (mirror `RAIL_WIDTH`, `RAIL_COLLAPSED_WIDTH`, `PAGE_GAP` in
  `packages/shared/src/models.ts`), `--strip-height` and `--bottom-height` (now the sidebar header
  and footer), `--tooltip-delay` 500ms, `--menu-width` 220px (minimum width of a context menu;
  eight `icon-lg` swatches fit in a row).
- Context menus: the system has no menu placement rule. Menus open with their top-left corner at
  the pointer and flip to the other side of it when they would leave the window, keeping an 8px
  margin (`placeMenu`); a submenu opens to the right of its row with the first item aligned to the
  row and flips to the left when there is no room (`placeSubmenu`). Closing tabs is not styled as
  `danger` (a closed tab can be reopened); the style is reserved for destructive workspace actions.
- Pinned tabs: Chrome's pinned tabs are the model, drawn as Arc-style favicon tiles above the
  workspace header (four per row, one column when collapsed). A pinned tile has no close control;
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
