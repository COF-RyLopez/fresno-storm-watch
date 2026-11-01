---
name: calcite
description: Use when building or changing UI in site/ with Esri Calcite components, --calcite-* tokens, or light/dark theming, or when replacing hand-rolled buttons, selects, inputs, tabs, badges, tables or banners with Calcite. Covers the exact Calcite builds this app loads (5.1.1 via ArcGIS Maps SDK 5.1 on most pages, 5.2.0 directly on map-pilot), their differences, and the SDK 5.2 upgrade checklist.
---

# Calcite in fresno-storm-watch

Full verified property lists, per-component CSS variables and the 5.1.1 -> 5.2 diff: [reference.md](reference.md).
Every name below was checked against developers.arcgis.com/calcite-design-system or the shipped 5.1.1 files.
If a name is not here or in reference.md, look it up before using it.

## 1. How Calcite loads here (5.1.1 on SDK pages, 5.2.0 on map-pilot)

**Check the page before using a prop.** Two Calcite versions are live, one per page (never two on one page):

| Page(s) | Calcite | Why |
|---|---|---|
| Every page that loads the Maps SDK (`js.arcgis.com/5.1/`): index, eoc, flood-scenario(-3d), zone-population, pump-* | **5.1.1** | bundled by the released SDK 5.1 |
| `site/map-pilot.html` (MapLibre, no Maps SDK) | **5.2.0** | loads `https://js.arcgis.com/calcite-components/5.2.0/index.js` directly |

- SDK pages load `<script type="module" src="https://js.arcgis.com/5.1/">`, which redirects to `/5.1/index.js`;
  its first line is `import "../calcite-components/5.1.1/index.js"`. A page cannot load a second Calcite
  version beside the SDK's (the `calcite-*` custom elements can only be registered once, and SDK widgets are built against 5.1.1).
- On map-pilot, the 5.2-only props listed below are allowed; everywhere else they silently do nothing.
- **Upgrading the SDK pages to 5.2:** wait for the released Maps SDK 5.2 (as of 2026-11-01 npm `@arcgis/core`
  `latest` is 5.1.27; `js.arcgis.com/5.2/` serves the `5.2.0-next` release candidate, which imports Calcite 5.2.0).
  Then in one PR: bump every `js.arcgis.com/5.1/` script and theme URL (and `theme.js`), regenerate import maps / CSP
  hashes, re-check the deprecations in reference.md (block `open`, dropdown `slot="trigger"`, accordion,
  `--calcite-color-background`/`foreground-*`), adopt the 5.2 props that were held back (e.g. slider `label` for
  `weather-time`, `scenario-clock`, `inundation-time`), browser-check light/dark (5.2 themes via `color-scheme` +
  `light-dark()`; the `calcite-mode-*` classes still work), and update this section.
- The Calcite entry registers every `calcite-*` tag lazily and injects its global CSS (tokens, mode classes)
  as a constructed stylesheet. No separate Calcite CSS `<link>` is needed. `<link id="esri-theme">` points at
  `https://js.arcgis.com/5.1/esri/themes/{dark|light}/main.css` (Maps SDK widgets + Calcite token blocks); `theme.js` swaps it.
- **Docs describe 5.2** (get-started snippet `calcite-components/5.2`, `@esri/calcite-design-tokens` 4.2).
  5.2-only props must not be used on SDK (5.1.1) pages yet: block `expandable`, action-bar `expandToggleDisabled`/`overflowMode`,
  input/-text/-number `inlineEdit*`, table `stickyHeader`, switch `required`, slider `label` (in 5.1.1 name a single-handle slider with `min-label`; verified in Chromium), `calcite-text`. See reference.md.
- CSP (`script-src`) allows only self + js.arcgis.com, and the import map is generated: after editing
  site JS/CSS run `npm run build:import-map`, then `npm test` (tests read page HTML and fail on stale maps).
- No bundler, no npm Calcite package. Version bumps touch every page's script tag, theme.js's theme URL and the CSP hash; do them on purpose, never in passing.

## 2. Pick the component, not hand-rolled HTML

| Need | Use | Instead of |
|---|---|---|
| App frame, side panels | `calcite-shell` + `calcite-shell-panel` (`slot="panel-start"`) | grid/flex page layout |
| Titled container with header actions | `calcite-panel` | `<section><h2>` + custom header bar |
| Collapsible group of controls in a panel | `calcite-block` (`collapsible`, `expanded`) | `<details><summary>` |
| Drill-in sub-view | `calcite-flow` + `calcite-flow-item` | manual show/hide of divs |
| Icon tool buttons / toolbars | `calcite-action` in `calcite-action-bar` | `<button>` with icon CSS |
| Primary/secondary command | `calcite-button` (`appearance`, `kind`) | `<button class=...>` |
| Navigate somewhere | `calcite-link` or `calcite-button href` | styled `<a>` button |
| Selectable rows of records | `calcite-list` + `calcite-list-item` | `<button class="record">` stacks |
| Inline persistent status / tip | `calcite-notice` | colored `<div>` banners |
| Transient result toast | `calcite-alert` (`auto-close`) | custom toast |
| Modal task / confirmation | `calcite-dialog` (`modal`) | custom overlay |
| Ephemeral side/bottom sheet | `calcite-sheet` | fixed-position div |
| Anchored interactive popup | `calcite-popover` | absolutely positioned div |
| Hover/focus hint (text only) | `calcite-tooltip` | `title=` for important info |
| Status badge / filter token | `calcite-chip` (in `calcite-chip-group` for selection) | `.pill` spans |
| Small fixed set of options (one) | `calcite-select` + `calcite-option` | `<select>` |
| Long/filterable or multi choice | `calcite-combobox` + `calcite-combobox-item` | custom autocomplete |
| 2–5 exclusive view modes | `calcite-segmented-control` | `aria-pressed` button pairs, `role=tablist` buttons |
| On/off setting | `calcite-switch` | checkbox styled as toggle |
| Yes/no or multi-select | `calcite-checkbox` in `calcite-label layout="inline"` | `<input type=checkbox>` |
| Text / search / number entry | `calcite-input-text`, `calcite-input` (`type="search"`), `calcite-input-number` | `<input>` |
| Range / time scrubber | `calcite-slider` | `<input type=range>` |
| Tabular data | `calcite-table` (+ `-row`, `-header`, `-cell`) | `<table>` with custom CSS |
| Quantity within bounds | `calcite-meter` | custom bar divs |
| Busy state | `loading` prop on button/panel/block/list, else `calcite-loader` | spinners |
| Entity summary tile | `calcite-card` | `.metric`/`.eoc-card` boxes |
| Top app bar | `calcite-navigation` + `calcite-navigation-logo` in shell `slot="header"` | custom header |
| Switch content views | `calcite-tabs` > `calcite-tab-nav slot="title-group"` > `calcite-tab-title`, + `calcite-tab` | custom tabs |

Accordion is **deprecated in 5.2** (docs: use Block Group/Block). Do not add new `calcite-accordion`; inside panels use `calcite-block`.

## 3. Component cheat sheet (5.1.1)

Format: purpose · key props (attribute form) · slots · events · main CSS vars. Full lists in reference.md.

- **shell** · `content-behind` · slots `header footer panel-start panel-end panel-top panel-bottom dialogs alerts sheets` · `--calcite-shell-border-color`.
- **shell-panel** · `display-mode` (`dock` default, `overlay`, `float-content`, `float-all`), `collapsed`, `resizable`, `layout`, `width` (`position` deprecated since 5.0: the shell slot decides) · slots default, `action-bar` · `--calcite-shell-panel-width`, `-max-width`, `-min-height`, `-max-height`, `-background-color`, `-z-index`.
- **panel** · `heading`, `description`, `heading-level`, `closable`/`closed`, `collapsible`/`collapsed`, `loading`, `icon`, `scale` · slots `header-actions-start header-actions-end header-menu-actions header-content content-top content-bottom action-bar alerts fab footer footer-start footer-end` (don't mix `footer` with `footer-start/end`) · `calcitePanelClose calcitePanelCollapse calcitePanelExpand calcitePanelToggle calcitePanelScroll` · `--calcite-panel-space`, `-footer-space`, `-content-top-space`, `-header-background-color`, `-background-color`.
- **block** · `heading`, `description`, `heading-level`, `collapsible`, `expanded` (**not `open`**: deprecated since 3.1), `loading`, `icon-start`, `disabled` · slots default, `actions-end content-start content-end header-menu-actions` · `calciteBlockExpand calciteBlockCollapse` · `--calcite-block-content-space`, `-border-color`, `-heading-text-color`, `-description-text-color`, `-icon-start-color`.
- **action** · `text` (**required**), `text-enabled`, `icon`, `active`, `indicator`, `loading`, `disabled`, `scale`, JS `aria` object · listen to `click` · `--calcite-action-text-color`, `-background-color(-hover|-press)`, `-indicator-color`.
- **action-bar** · `layout` (`vertical`/`horizontal`), `expanded`, `expand-disabled`, `floating`, `overflow-actions-disabled` · slots default, `actions-start actions-end expand-tooltip` · `calciteActionBarToggle` · `--calcite-action-bar-items-space`, `-expanded-max-width`, `-background-color`. Parent should be flex.
- **list / list-item** · list: `label` (**required**), `selection-mode` (`none` `single` `single-persist` `multiple`), `selection-appearance`, `filter-enabled`, `filter-placeholder`, `display-mode`, `interaction-mode`, `loading`; item: `label`, `description`, `value`, `selected`, `disabled`, `icon-start`, `closable` · item slots `actions-start content-start content content-end actions-end content-bottom`; list slots `empty-content filter-actions-start filter-actions-end` · `calciteListChange` (read `list.selectedItems`), `calciteListFilter`, `calciteListItemSelect`, `calciteListItemClose` · `--calcite-list-background-color(-hover|-press)`, `-label-text-color`, `-description-text-color`, `-icon-color`, `-border-color`.
- **notice** · `open`, `kind` (`brand` `danger` `info` `success` `warning` `neutral`), `icon` (true or name), `closable`, `scale`, `width="full"` (`half` deprecated), `appearance` · slots `title message link actions-end` · `calciteNoticeClose calciteNoticeOpen` · `--calcite-notice-background-color`, `-border-color`, `-title-text-color`, `-content-text-color`, `-corner-radius`, `-shadow`.
- **alert** · `open`, `label` (**required**), `kind` (`brand` `danger` `info` `success` `warning`), `auto-close`, `auto-close-duration`, `placement`, `queue`, `icon` · slots `title message link actions-end` · `calciteAlertClose calciteAlertOpen` · `--calcite-alert-width`, `-background-color`, `-offset-size`. Put alerts in shell `slot="alerts"` (or panel `alerts`).
- **dialog** · `open`, `modal`, `heading`, `description`, `heading-level`, `kind`, `width` (s/m/l; `width-scale` deprecated), `placement`, `loading`, `escape-disabled`, `outside-close-disabled`, JS `beforeClose` · slots default, `footer footer-start footer-end header-actions-end content-top content-bottom alerts` · `calciteDialogClose calciteDialogOpen calciteDialogBeforeClose` · `--calcite-dialog-size-x`, `-size-y`, `-max-size-x`, `-content-space`, `-footer-space`. Traps focus automatically.
- **sheet** · `open`, `label` (**required**), `position` (`inline-start` default, `inline-end`, `block-start`, `block-end` for touch), `display-mode` (`overlay`/`float`), `resizable` · default slot (put a `calcite-panel` inside) · `calciteSheetClose calciteSheetOpen` · `--calcite-sheet-width`, `-height`, `-max-width`.
- **chip** (+ chip-group) · `label` (**required**), `kind` (`brand` `inverse` `neutral`), `appearance` (`outline` `outline-fill` `solid`), `icon`, `closable`, `selected`, `value`; group: `label` (**required**), `selection-mode` · slots default, `image` · `calciteChipClose calciteChipSelect calciteChipGroupSelect` · `--calcite-chip-background-color`, `-border-color`, `-text-color`, `-icon-color`.
- **button** · `appearance` (`solid` `outline` `outline-fill` `transparent`), `kind` (`brand` `danger` `inverse` `neutral`), `scale`, `icon-start`, `icon-end`, `href`/`target`/`rel`, `loading` (+ `disabled` to block clicks), `width` (`full`), `label`, `type` · listen to `click` · `--calcite-button-background-color`, `-text-color`, `-border-color`, `-corner-radius`, `-icon-color`.
- **input / input-text / input-number** · `value`, `placeholder`, `label`, `label-text`, `clearable`, `status` + `validation-message` + `validation-icon`, `prefix-text`, `suffix-text`, `max-length`, `read-only`, `required`, `scale`; input adds `type`; number adds `min max step integer` · slot `action` · `calciteInputInput`/`calciteInputChange`, `calciteInputTextInput`/`calciteInputTextChange`, `calciteInputNumberInput`/`calciteInputNumberChange` (Input = each keystroke, Change = committed) · `--calcite-input-background-color`, `-border-color`, `-text-color`; `--calcite-input-text-*`, `--calcite-input-number-*` for those tags. Methods `setFocus()`, `selectText()`.
- **select** · `label` (**required**), `label-text`, `value`, `scale`, `disabled`, `status`; children `calcite-option` (`value`, `selected`, `disabled`, `label`) / `calcite-option-group` · `calciteSelectChange` (read `select.value` or `selectedOption`) · `--calcite-select-font-size`, `-background-color`, `-border-color`, `-text-color`.
- **combobox** · `label` (**required**), `label-text`, `selection-mode` (`single` `single-persist` `multiple` `ancestors`), `placeholder`, `max-items`, `allow-custom-values`, `select-all-enabled`, `clear-disabled`; items: `value`, `heading`, `description`, `selected`, `icon` · `calciteComboboxChange` (read `selectedItems` / `value`), `calciteComboboxFilterChange` · `--calcite-combobox-background-color`, `-input-height`, `-input-text-color`.
- **segmented-control** · `value`, `label-text`, `layout`, `width` (`full`), `scale`, `disabled`; items: `value`, `checked`, `icon-start` (`appearance` on the control is deprecated in 5.2) · `calciteSegmentedControlChange` · `--calcite-segmented-control-border-color`, item `--calcite-segmented-control-color`, `-background-color`, `-icon-color`.
- **switch** · `checked`, `label`, `label-text-start`, `label-text-end`, `scale`, `disabled` · `calciteSwitchChange` · `--calcite-switch-background-color`, `-handle-background-color`. Use for settings/layer visibility, not "A or B".
- **checkbox** · `checked`, `indeterminate`, `label`, `label-text`, `value`, `disabled`, `scale` · `calciteCheckboxChange` · `--calcite-checkbox-size`, `-border-color`, `-icon-color`.
- **label** · `layout` (`block` default, `inline`; `default` deprecated -> `block`), `for`, `scale`, `alignment` · `--calcite-label-margin-bottom`, `--calcite-label-text-color`.
- **loader** · `label` (**required**), `type` (`indeterminate`, `determinate`, `determinate-value`), `value`, `inline`, `text`, `scale` · `--calcite-loader-size`, `-progress-color`, `-track-color`.
- **tooltip** · `reference-element` (id string or element), `placement`, `open`, `close-on-click`, `scale`; content in a `<span>`/`<p>` · `calciteTooltipOpen calciteTooltipClose` · `--calcite-tooltip-background-color`, `-text-color`, `-max-size-x`.
- **popover** · `reference-element`, `label` (**required**), `heading`, `heading-level`, `closable`, `auto-close`, `placement`, `trigger-disabled`, `open`, `overlay-positioning` · `calcitePopoverOpen calcitePopoverClose` · `--calcite-popover-background-color`, `-max-size-x`.
- **tabs** · tabs: `layout`, `position`, `bordered`, `scale`; tab-title: `tab`, `selected`, `icon-start`, `disabled`; tab: `tab`, `selected` · `calciteTabsActivate` (on tab-title), `calciteTabChange` (on tab-nav) · `--calcite-tab-border-color`, `--calcite-tab-text-color`, `--calcite-tab-background-color`. Docs: not for top-level page navigation.
- **table** · `caption` (accessible name), `bordered`, `striped`, `numbered`, `page-size`, `selection-mode`, `layout`, `scale`; rows: put header rows in `slot="table-header"`; `calcite-table-header` `heading`/`description`; `calcite-table-cell` `alignment` · slots `table-header table-footer selection-actions` · `calciteTableSelect calciteTablePageChange calciteTableRowSelect` · `--calcite-table-border-color`, row `--calcite-table-row-background-color`, cell `--calcite-table-cell-text-color`.
- **meter** · `label` (**required**), `value`, `min`, `max`, `low`, `high`, `fill-type` (`range` default / `single`), `value-label`, `range-labels`, `value-label-type`/`range-label-type` (`percent`/`units`), `unit-label` · `--calcite-meter-fill-color`, `-background-color`, `-value-text-color`.
- **card** · `label`, `loading`, `selected`, `thumbnail-position` (`selectable` deprecated: use `selection-mode` on a parent `calcite-card-group`) · slots `thumbnail heading description footer-start footer-end` + default · `--calcite-card-background-color`, `-border-color`, `-shadow`.
- **navigation** · `label`, `navigation-action`, `scale` · slots `logo user progress navigation-action content-start content-center content-end navigation-secondary navigation-tertiary` · logo: `heading`, `description`, `heading-level`, `thumbnail`, `href` · `--calcite-navigation-background-color`, `-border-color`.
- **accordion** (existing uses only) · item `heading`, `description`, `expanded`, `icon-start` · `calciteAccordionItemExpand/Collapse` · `--calcite-accordion-item-content-space`.
- **dropdown** · put `calcite-dropdown-item`s inside `calcite-dropdown-group`; use `reference-element` not `slot="trigger"` (deprecated 5.1) · `calciteDropdownSelect`.

## 4. Tokens

Use semantic tokens in app CSS instead of hex/px. 5.1.1 ships all names below (checked in its CSS).

- **Surfaces** (current): `--calcite-color-surface-1` (page), `-surface-2` (panels/cards), `-surface-3`, `-surface-4`, `-surface-highlight`.
  Deprecated (still shipped, removal v6) and **shifted by one**: `background`->`surface-1`, `foreground-1`->`surface-2`,
  `foreground-2`->`surface-3`, `foreground-3`->`surface-4`, `foreground-current`->`surface-highlight`. New code uses `surface-*`.
- **Text**: `--calcite-color-text-1` (primary), `-text-2` (secondary), `-text-3` (tertiary), `-text-inverse`, `-text-link`, `-text-highlight`.
- **Border**: `--calcite-color-border-1`, `-border-2`, `-border-3`, `-border-input`, `-border-ghost`.
- **Brand / focus**: `--calcite-color-brand`, `-brand-hover`, `-brand-press`, `-brand-underline`; `--calcite-color-focus` (there is no `-focus-color`).
- **Status**: `--calcite-color-status-{info|success|warning|danger}` each with `-hover`, `-press`. For non-text indicators, not backgrounds.
- **Transparent/inverse**: `--calcite-color-transparent`, `-transparent-hover`, `-transparent-press`, `-transparent-scrim`, `-transparent-tint`, `--calcite-color-inverse`.
- **Space** (current): `--calcite-space-{none|px|base|2xs|xs|sm|sm-plus|md|md-plus|lg|xl|2xl|3xl|4xl}`
  (2px base, 2xs .25rem, xs .375rem, sm .5rem, md .75rem, lg 1rem, xl 1.25rem, 2xl 1.5rem, 3xl 2rem).
  `--calcite-spacing-*` is **deprecated since tokens v4** (removal v6); `spacing-xxs`->`space-2xs`, others same suffix.
- **Font size**: `--calcite-font-size-xs` 10px, `-sm` 12px, `--calcite-font-size` 14px, `-md` 16px, `-lg` 18px, `-xl` 20px, `-2xl` 24px
  (`-xxl` deprecated); relative variants `--calcite-font-size-relative-{xs|sm|base|md|lg|xl|2xl...}`. The numeric scale
  (`--calcite-font-size--2`, `--1`, `-0`, ...) is shipped but undocumented: prefer the named sizes in new code.
- **Weight / family / line-height**: `--calcite-font-weight-{light|regular|medium|semibold|bold}` (`-normal` deprecated), `--calcite-font-family`, `--calcite-font-family-code`, `--calcite-font-line-height-relative-{tight|snug|normal|relaxed|loose}`.
- **Corner radius**: `--calcite-corner-radius` (0), `-none`, `-xs` 2px, `-sm` 4px, `-pill` (`-round`/`-sharp` deprecated).
- **Shadow / opacity / stacking**: `--calcite-shadow-{none|sm|md}`, `--calcite-opacity-{disabled|light|half|dark|full}`, `--calcite-z-index{,-sticky,-header,-toast,-dropdown,-overlay,-modal,-popup,-tooltip}`.
- **Component tokens** (`--calcite-panel-space`, `--calcite-shell-panel-width`, ...) override one component; set on the tag or an instance class. Only the names in reference.md exist.

App-specific tokens live in `site/theme.css` (`--app-*`, alert/gauge/chart/map colors with `:root` light and
`:root.calcite-mode-dark` dark values). Several are read by `map.js` for map symbols and legends, so do not swap them for
Calcite status colors without checking those readers. New UI chrome should use Calcite tokens; new data colors go in theme.css with both modes.

## 5. Theming and modes

- `site/theme.js` (runs before paint) sets `<html data-theme>`, toggles `calcite-mode-dark` / `calcite-mode-light` on `<html>`,
  swaps the `#esri-theme` stylesheet, saves `fresno-storm-watch-theme` in localStorage, and dispatches `storm-theme-change` on `window`
  (listen to it to re-render canvas/map colors). Pages start with `class="calcite-mode-dark" data-theme="dark"`.
- In 5.1.1, token values are switched **by those classes** (`.calcite-mode-light`, `.calcite-mode-dark`, `.calcite-mode-auto` with
  `prefers-color-scheme`). 5.2 moves to `:root{color-scheme}` + `light-dark()` and keeps the classes (they set `color-scheme`).
  The 5.2 docs' advice "use `color-scheme` / `light-dark()`" therefore does **not** switch tokens in 5.1.1: keep using the classes.
- A subtree can use the other mode by adding `calcite-mode-light`/`-dark` to its container.
- Brand override (docs pattern): set `--calcite-color-brand`, `-brand-hover`, `-brand-press`, `-brand-underline` on `:root` (and under `:root.calcite-mode-dark`).
- `scale` is `s` | `m` | `l` (default `m`). This app's dense panels use `scale="s"` for buttons, selects, notices and accordions; match neighbours.

## 6. Accessibility rules

- `label` is **required** on alert, chip, chip-group, combobox, list, loader, meter, popover, select and sheet. Action needs `text` even when `text-enabled` is off (it becomes the accessible name).
- Icon-only `calcite-button`: set `label`. Docs: avoid icon-only buttons when the meaning is unclear; prefer visible text.
- Form controls: wrap in `calcite-label` (the repo's pattern) **or** set `label-text`; not both. Inline checkbox: `<calcite-label layout="inline"><calcite-checkbox>` + text.
- Keep the outline: set `heading-level` on panel/block/dialog/popover (panels here use `heading-level="2"`).
- Alert role is computed (5.1.1 source): `auto-close` -> `role="alert"`, otherwise `role="alertdialog"`. Notice has no live
  region; for changing text put `role="status"` on the slotted element (`index.html` power banner: `<span slot="title" role="status">`).
- Tooltip: text inside an element; never on a disabled control (keyboard users cannot reach it); place it shallow in the DOM,
  not inside its reference element; its `label` prop is deprecated.
- Toggle actions: `action.active = true` plus `action.aria = { pressed: true }` (or `{ expanded }` when it shows/hides a panel).
- Links: unique text (not "Learn more"); signal when a link opens a new tab.
- Don't convey state by color alone: pair status color with icon/text (notice `kind` + `icon`, chip text).
- Calcite components honour `forced-colors` and `prefers-reduced-motion`; don't add animations that bypass it.

## 7. JS patterns in this repo

- Reuse `site/lib/dom.js`: `el`, `node`, `elClass`, `elIfText`, `elAttrs` and `button`/`nodeButton`/`classButton`
  (a `calcite-button` with `scale='s'`, `appearance='outline'`). Its header says to keep each caller on the exact helper it already uses.
- Publisher/service text is always `textContent`, never `innerHTML`.
- Simple props are set right after creation (`b.scale='s'; b.appearance='outline'`, `host.layout='inline'`). Before calling methods
  (`setFocus()`, `scrollContentTo()`) or reading `selectedItems`, wait for definition:
  `await customElements.whenDefined('calcite-input'); input.setFocus();` (see `app.js:258`, `lib/map-search-ui.js:124`).

```js
import {el,node} from './dom.js';
const label=node('calcite-label');label.layout='inline';
const box=node('calcite-checkbox');box.checked=true;
box.addEventListener('calciteCheckboxChange',()=>setVisible(box.checked));
label.append(box,document.createTextNode('Show sites on map'));

const select=node('calcite-select');select.label='Facility review filter';select.scale='s';
for(const [value,text] of [['review','Needs review'],['all','All sites']]){const o=el('calcite-option',text);o.value=value;select.append(o);}
select.addEventListener('calciteSelectChange',()=>render(select.value));

const notice=node('calcite-notice');notice.kind='warning';notice.icon=true;notice.open=true;notice.width='full';notice.scale='s';
const title=el('span','Feed delayed');title.slot='title';title.setAttribute('role','status');
notice.append(title,Object.assign(el('span','Last success 14:05'),{slot:'message'}));
```

- Calcite controls do not fire native `change`/`input`: a `change` listener on `calcite-checkbox` never runs.
- Events used here: `calciteSelectChange`, `calciteCheckboxChange`, `calciteInputInput`, `calciteListChange`, `calciteSliderInput`,
  `calciteSegmentedControlChange`, `calcitePanelClose`, `calciteSwitchChange`, `calciteSheetClose`, `calciteDropdownSelect`,
  `calciteBlockExpand`/`calciteBlockCollapse`. Read state from the element after the event. Don't rely on these events
  firing when you set `value`/`checked` from code; call your render path directly.
- Visibility: `[hidden]{display:none!important}` is global in `calcite-layout.css`, `eoc.css` and `map-pilot.css`, so
  `el.hidden=true` works on any `calcite-*` tag. For notice/alert/dialog/sheet/popover use `open`; for panel `closed`; for block `expanded`.
  These keep their transitions and open/close events.
- Existing deprecated usages to migrate when touched: `<calcite-block ... open>` in `index.html:212-214` -> `expanded`;
  `slot="trigger"` dropdown in `index.html:364` -> `reference-element`; `expand-disabled` (5.2-deprecated, still correct in 5.1.1).

## 8. Anti-patterns

- Raw hex/px in new chrome CSS (`#67cad1`, `font-size:12px`, `padding:10px`) where a token exists; hex fallbacks such as
  `var(--calcite-color-text-1,#e3e6e8)` on pages that always load Calcite.
- Inventing component CSS vars. These appear in `site/*.css` but are not documented or shipped in 5.1.1, so they do nothing:
  `--calcite-action-padding`, `--calcite-button-font-size`, `--calcite-button-padding-inline`, `--calcite-notice-content-space`,
  `--calcite-tab-padding`, `--calcite-color-focus-color`, `--calcite-font-size-small`.
- Styling Calcite internals with descendant selectors; use the component's CSS vars, props (`scale`, `appearance`, `kind`) or slots.
- Native `<button>`, `<select>`, `<input>`, `<input type=range>`, `<table>` or `<details>` inside Calcite panels (see §2).
- Using 5.2-only props from the docs (see reference.md diff); using deprecated `open` on block, `position` on shell-panel, `width-scale`, `label` on tooltip, `width="half"`.
- New `calcite-accordion` (deprecated 5.2); stacking several notices or alerts; tooltips holding essential or interactive content (use popover/dialog).
- `calcite-switch` for A-vs-B choices (use segmented control); `calcite-select` for two options (checkbox, switch or segmented control).
- Calling methods or reading `selectedItems`/`selectedOption` before `customElements.whenDefined(...)` resolves.
- Bumping the js.arcgis.com version in one page only.
