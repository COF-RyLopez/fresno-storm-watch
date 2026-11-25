# Command weather and inspection layout

**Goal:** Implement the approved map/strip/Details layout without changing feeds, permissions or operational concern rules.

**Architecture:** Put the MapLibre canvas in a bounded viewport above a static weather strip. Reuse one Details inspector for Place, Weather, Map key and temporary map readings. Keep one map and current weather adapters. Standardize timeline controls and route long tap readouts to the inspector; short desktop hover previews use bounded screen placement.

**Execution:** Inline using executing-plans and test-driven development; independent review before publication. Existing checkout, new branch from main. Version 0.103.0.

## Constraints

- Preserve selected place, camera, weather time, pending drafts, source permissions and private sign-out clearing.
- Keep observation/forecast mode, valid time, units, freshness qualification and active weather legend visible.
- No growing overlay or nested gauge/source scroll region over the map. One scroll region in the inspector; native timeline slider and buttons with 44 px targets.
- Preserve gaps, fixed publisher colors, issue times and current-data fallback. No changes to rainfall/gust/snow calculations or alert scope.
- Preserve existing alert autoplay and reduced-motion handling; manual product changes begin paused.

## Tasks

1. [x] Add failing tests for inspector selection/close/back behavior and private clearing. Implement a focused inspector controller and move source/key content into the existing side pane.
2. [x] Make the map viewport plus compact weather strip real layout rows. Keep phone Attention/Map/Details and an explicit Return to map action. Make detailed inspector modes mutually exclusive.
3. [x] Reuse one indexed slider for rain/gust/snow, previous/next controls and a compact timeline. Preserve cached frame validation, alert timing, selected actual time and missing-frame states.
4. [x] Add tests for hover edge/obstacle clamping, short previews and click-to-inspector. Retain legacy behavior for callers without the new inspection callback.
5. [ ] Publish after successful CI and verify the deployed page. Local test/build/check, independent review and bounded desktop/phone inspection completed; see `docs/command-weather-layout.md` for evidence and limitations.

## Review focus

- Background refresh must not reopen a dismissed inspector or replace a weather/key tab with selected-place text.
- Closing Details must not clear the selected place or reset the camera.
- Source and gauge content must remain accessible with no selected concern, including on phones.
- Popup bounds must use the actual map viewport, not page width, and avoid top tools and bottom controls.
- All product sliders must map only to available frames; changing products or scope must cancel old playback/readouts.

## Acceptance

At 1920×1080, 1280×720, 390×844 and 844×390, controls and inspector close/return actions remain visible, weather stays outside the canvas, legends/valid times remain understandable, and no horizontal page overflow occurs. Check 200% zoom, reduced motion, missing products, last frame and rapid switching. Record browser evidence and actual limitations; no performance claim from CSS alone.
