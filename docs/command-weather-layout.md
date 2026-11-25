# Command weather controls and Details

Release 0.103.0 replaces the expanding map overlay with a weather strip below the actual map viewport. The map resizes around that strip; weather content cannot grow upward over the map or get clipped by its container.

## Operator workflow

- Choose **Rain forecast**, **Gust forecast**, **Observed radar**, **Observed snow cover** or **Snow forecast** in the strip. Keep the valid time and weather legend beside the timeline.
- Use **Play/Pause**, the slider and **Previous/Next** to inspect actual available periods. Radar also has **Latest**. No missing periods are synthesized.
- Open **Weather details** for issue/model times, source, method and coverage. It uses the same Details pane as selected-place evidence.
- Open **Map key** for reference layers, gauge status colors, explanations and gauge readings. The list scrolls in the pane, not over the map.
- Hover for a short map preview; tap/click a gauge or other dated readout for its complete information in Details. Cloud-top inspection uses the same path when enabled. Preview placement is constrained to the map viewport and avoids map controls.
- **Place**, **Weather** and **Map key** organize one inspector. Closing the pane preserves the location and camera. **Return to map** and the phone's **Attention / Map / Details** controls preserve the selected forecast frame.

The interface switches to its compact layout on narrow screens or screens no taller than 520 pixels. Short landscape views use a two-column weather strip and horizontal zoom controls. All standard weather and map action buttons retain 44-pixel targets. Observation/forecast distinctions, fixed publisher colors, missing-data notices and source time qualifications stay intact.

## Boundaries

This changes presentation and inspection only. Weather collection, prepared-rainfall freshness/revision checks, official alerts, authorization and exercise storage remain unchanged. Nothing is submitted, assigned or approved automatically. Source and private operational data are not added to persistent browser storage.

The legacy map inspection behavior remains available to callers that do not opt into the Command inspector, avoiding a forced change to the retained legacy app.

## Verification

- 1,115 JavaScript tests passed, including inspector close/selection/private clearing, product-change readout cleanup, stale async timeline responses, timeline gaps/steps, radar stepping, edge/obstacle placement and full-readout callbacks.
- Command type check, Vite build, content-keyed imports and repository checks passed.
- Browser layouts checked at 1920×1080, 1280×720, 390×844 and 844×390. Also checked 640×360 as the CSS-layout equivalent of a 1280×720 viewport at 200% zoom; this is not a claim of physical-phone or assistive-technology certification.
- Phone rain: approximately 500 px of map plus 159 px of strip, with no map/strip overlap or horizontal document overflow. Short landscape: approximately 125 px of map plus 103 px of strip with controls inside the viewport.
- Real gauge tap opened a complete dated reading in Details. Keyboard Close focused `command-map`; the selected Kings River place and URL survived closing.
- Live rain and gust timeline controls worked. Radar displayed a dated observed mosaic. The local preview's missing snowfall grid correctly retained explicitly labeled point guidance; missing grid coverage was not rendered as zero snow.
- Independent review findings (stale reading after product switch, late empty-state overwrite and close focus) were reproduced in failing tests and corrected.

Staff acceptance on their own phones and screen readers remains part of the pilot. Rollback is redeploying the prior app version; no data migration is involved.
