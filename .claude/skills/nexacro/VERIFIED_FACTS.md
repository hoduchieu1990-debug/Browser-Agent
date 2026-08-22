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
