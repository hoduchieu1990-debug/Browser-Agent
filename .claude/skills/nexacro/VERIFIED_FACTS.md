# Verified against a real Nexacro N app (demo.tobesoft.com)

The docs in this folder (old and new) both make API claims that turned out
to be wrong when checked against a real Nexacro N page. This is what was
actually confirmed live, so the next round of work doesn't have to
re-derive it.

- `window.nexacro.getActiveFrame()` — **does not exist**. Used throughout
  `NEXACRO_QUICK_START.md` / `nexacro_element_recording_skill.md` /
  `nexacro_helper_minimal.py`. Any code built on it is dead on arrival.
- `window.nexacro.getApplication()` — **real**, and `app.mainframe` (not
  `app.mainForm`, which `nexacro_browser_agent_skill.md` and
  `nexacro_object_model_api_guide.md` both assume) leads to the component
  tree: `app.mainframe.WorkFrame.form.divWork.form...`.
- A rendered element's DOM `id` **is** the component's dotted object-model
  path (e.g. `mainframe.WorkFrame.form...TextField00.box:simpleinput`),
  sometimes with a trailing internal rendering suffix (`:simpleinput`,
  `:input`) that isn't a public property. Walking the id and stopping at the
  last segment that resolves lands on the real component — but only the
  *last* segment is allowed to miss; a miss earlier means the component tree
  isn't finished building yet (real, for ~1s right after a fresh
  navigation), not "resolved to a shallower parent."
- `[data-component="Button"]`-style attributes, described in
  `nexacro_object_model_api_guide.md` and `nexacro_browser_agent_skill.md`
  as the rendered markup — **not present** on a real page (checked: 0
  matches). Don't rely on them.
- `comp.set_value(v)` is real and updates both the component's own `.value`
  and the live DOM input synchronously.
- `comp.onclick` / `comp.onchange` on a real component are Nexacro
  **EventHandler objects, not plain functions** — calling them
  unconditionally (`comp.onclick?.()`) throws. `comp.click()` alone already
  runs the click handling; guard the others with
  `typeof comp.onclick === 'function'`.
- `get_value()` as a method doesn't exist on components observed live —
  read `.value` directly.
- Ids are long (100–150+ chars) but genuinely stable — see `isStableId` in
  `extension/src/utils/selector-utils.ts`.

The corrected implementation lives in `extension/src/nexacro-bridge.ts` and
`player/src/utils/nexacro.ts`.

## Dynamic work windows (multi-screen MES/ERP-style apps)

Everything above was verified against demo.tobesoft.com, a single-frame app.
A real multi-screen Nexacro app (confirmed against two recordings exported
from a production Samsung MES system) opens each screen in a dynamically
created "work window" whose frame id carries an instance suffix assigned the
moment it opens — e.g. `winFFM0371_0_744` — and a **different** suffix the
next time the same screen opens, even within the same session. A component
id recorded under it (`...workFrameSet.winFFM0371_0_744.form.divLeft...`)
therefore stops resolving by literal property walk on a later run.

Both `resolveComponent` (bridge) and the inline resolvers in
`player/src/utils/nexacro.ts` now recover this: when a path segment matches
`/^(win[A-Za-z0-9]+)_\d+_\d+$/` and a literal lookup on it fails, they derive
the stable prefix (`winFFM0371`) and ask the containing object for whichever
frame is *currently* serving that prefix — `getActiveFrame()` first, then a
linear scan of `.all` for a frame whose `.id` starts with the prefix —
instead of failing. No recorder change was needed: the DOM id captured at
record time already has this shape, only the replay-side resolution had to
change.

Both the recovery algorithm and the exact regex (the "win" prefix, not a
bare `.+`) were independently confirmed by decompiling a live production
Nexacro automation extension (`background.js`'s own `getActiveFrame()` + `.all`
scan-by-id-prefix resolver matches this implementation near verbatim) —
not just inferred from the two example recordings.

## Nexacro Grid — read the bound dataset, never the DOM

`grid.getBindDataset()` returns a Dataset with `rowcount`/`colcount` and
`getColID(i)`/`getColumn(row, colId)` — this holds every row regardless of
what's scrolled into view (Grid virtualizes both rows and off-screen
columns; a far cell can have no DOM node at all). `grid.getCellText(row,
cellIndex)` returns what the grid actually paints (combo-mapped codes
resolved to their label, numbers formatted) — prefer it over the dataset's
raw values when the on-screen text is what's needed.

Mapping a body format-cell index to its header caption must go through each
cell's own `col`/`colspan` from the Format metadata
(`grid.getCellCount('head'|'body')` + `grid.getCellProperty(band, i, prop)`),
never by pairing head and body cells at the same rendered position — a
merged group header or a hidden captioned column makes the head band's index
space diverge from the body band's, so positional matching silently reads
the wrong column for some cells. Implemented in both
`extension/src/nexacro-bridge.ts` (`extractGridData`, action `extract_grid`)
and `player/src/utils/nexacro.ts` (`nexacroExtractGrid`); wired into the
`extractTable` action in both `extension/src/utils/replay-executor.ts` and
`player/src/actions/extract-table.ts` whenever the selector is a
`nexacro:` one.

## A Grid's interior is not addressable as components

Only top-level control types are marked (`INTERACTIVE_TYPES` in
`nexacro-bridge.ts`). Everything a Grid draws inside itself — rows, cells,
and the tree items and checkboxes rendered in them — is not, and their
`controlType`s (`TreeItemIconControl`, `CheckBoxControl`, `GridBandControl`,
`GridCellControl`) show up constantly in real recordings: roughly half the
steps in the two production MES recordings are nodes of that kind.

Because `findNexacroComponent` resolved by `closest('[data-ba-nexacro-id]')`,
those all used to resolve *up to the owning Grid* — clicking one tree row
recorded `nexacro:<grid>` and replayed as `grid.click()`, which does nothing
useful. Hover detection has been split in two accordingly
(`extension/src/utils/nexacro.ts`):

- `findNexacroComponent` — for clicks and typed values. Returns nothing for a
  node inside a Grid, so it falls through to a CSS selector aimed at that
  exact node. This matches the reference tool, which targets the node itself
  (`div.TreeItemIconControl[id$=".cell_7_0.celltreeitem.treeitembutton"]`) and
  lists only `dom` in its `fallbackStrategies` for these types — never the
  component API.
- `findNexacroGrid` — for table extraction only, where resolving a cell up to
  its Grid is exactly right, since the rows come from the bound dataset.

Pinned by `.verify/nexacro-grid-target-check.js`.

## Not implemented (deliberately out of scope)

- **prepareGrid** (widening a virtualized grid to render an off-screen
  column before clicking one specific cell): would need the recorder to
  start marking `GridCellControl`-type nodes (currently excluded from
  `INTERACTIVE_TYPES` as internal render sub-parts) and capture row/col, a
  bigger change to the marking allowlist that needs verifying against a real
  virtualized grid to get right.
- **MaskEdit raw-value handling**: the concern (a recorder capturing the
  masked *display* text while `set_value` needs the raw digits) doesn't
  obviously apply here — this project's recorder already reads/writes
  through the component's own `.value` via `get_value`/`set_value`
  (see above), never the DOM's rendered text, so there may be nothing to
  fix. Revisit only if a real MaskEdit field is observed round-tripping
  incorrectly.
