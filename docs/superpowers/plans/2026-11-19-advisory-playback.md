# Advisory playback implementation plan

**Goal:** A user selecting an alert sees its focused map and explanatory weather playback, with visible timing, legend and Pause.

**Approved direction:** Reuse the Command weather dock. Winter accumulation → six-hour snow, wind → gusts, flood planning → rain, flash-flood/thunderstorm warnings → recent radar. Forecasts remain distinct from observations. This is a preview; no automatic deployment or private storage changes. During implementation the user chose regular radar over experimental volumetric frames; Command hides the Volume control and does not request that data.

**Architecture:** A bounded, serial forecast player shares buffering, cancellation and user controls across rain, gust and snowfall. Existing radar playback receives an optional explicit autoplay intent. No new dependencies.

**Constraints:** Autoplay follows direct alert selection only, never a feed refresh or Back navigation. Reduced-motion users start paused. Leaving Watch, hiding the page, changing the product or pausing cancels playback. Missing frames stop playback with a dated qualification. At most three forecast frames stay cached. A single frame has no playable sequence. Playback stops at the end and does not loop forecast time backward.

**Motion:** Explain progression through published times, with 1.8 seconds per settled forecast frame. Radar retains existing observed-scan transitions. No interpolated meteorological values or invented intermediate forecast times.

- [x] Add behavior tests for buffering, finite playback, cancellation, unavailable frames and reduced motion; confirm red, implement shared player, confirm green.
- [x] Integrate player and explicit selection intent into rain, gust, snow and radar. Test product routing, hidden states, delayed requests and failures.
- [x] Run full tests, type/build/site checks; verify desktop and phone public-source previews, including one reduced-motion check. Obtain one final read-only code review. Commit and provide the preview/PR.

**Verification:** 1,016 Node tests pass; TypeScript, Vite build, content-keyed import maps, site checks and public waterway archive packing pass. Live browser checks used current NWS wind and winter alerts, current public snowfall grids and named NWS gust samples. Radar replay returned 12 dated observed scans and no Volume control. The preview's default reduced-motion preference correctly suppressed autoplay; a temporary no-preference emulation verified playback and was cleared afterward. Actual phone hardware and non-specialist acceptance remain separate.

**Review fixes:** A delayed radar preparation cannot override Latest; unavailable volumes preserve the existing echo fallback in specialist views; gust selectable times and playable times use the same alert period. Regression tests were observed red before their fixes. A queued old forecast timer is also prevented from pausing a newer replay.

**Review focus:** Late frame loads cannot repaint another alert; background refresh cannot restart playback; gaps cannot become zero; advisory timing limits only forecast playback (radar shows recent observations); private actions retain sign-in and incident requirements.
