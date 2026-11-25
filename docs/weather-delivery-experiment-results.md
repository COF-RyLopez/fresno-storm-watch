# Weather delivery experiment — November 24, 2026 Pacific

Prepared WPC rainfall frames are worth testing in Command. This experiment reduced weather-data readiness time by about half under a controlled 80 ms per-request delay, while preserving the exact image and associated evidence. It does **not** establish a full-app, GPU, animation, production CDN or physical-phone speed improvement.

## What ran

The laboratory uses Command's existing MapLibre terrain renderer and current `loadWatershedRain` implementation. Three public WPC frames were recorded at **2026-11-25 05:42:00.819 UTC**: the 72-hour overview and two available six-hour windows. The first six-hour service window was expired and was excluded. Capture never relaxes the current adapter's source-cycle, age, unit or rollover checks.

Both delivery paths run on the same local HTTP server, with the same recorded source responses and forecast image bytes:

- **Current:** execute the actual rainfall adapter against the recorded five-request service workflow.
- **Prepared, cold:** fetch a small manifest and the selected immutable PNG. Verify length, dimensions and SHA-256, then verify the shared evidence fingerprint.
- **Prepared, repeat:** reuse the previously validated frame from a bounded, three-frame memory cache. No browser persistence.

Five paired trials per forecast period alternate method order. Each profile has 15 current, 15 prepared-cold and 15 prepared-repeat measurements. Timing ends **after** the common image/metadata identity check; a regression verifies that validation time is included. Terrain startup, map painting, user sign-in and other feeds are outside this interval. Recorded source bodies are served without compression or an artificial bandwidth cap. Payload counts are response-body bytes, not production network egress accounting.

## Results

| Profile | Current median | Prepared cold median | Requests per frame, current → prepared |
|---|---:|---:|---:|
| 1280×720, 80 ms imposed delay per weather request | 380.6 ms | 190.7 ms | 5 → 2 |
| 1280×720, no imposed delay | 24.3 ms | 9.7 ms | 5 → 2 |
| 390×844, 80 ms imposed delay | 394.2 ms | 193.5 ms | 5 → 2 |

All **135** measured deliveries/reuses matched. Repeat delivery required no HTTP requests; its measured duration was near browser timer resolution and should not be described as literally instantaneous. Across the three frames, the median response-body total fell from 68,592 to 54,604 bytes. The main gain is fewer round trips and repeated source-query assembly, not a large image-size reduction.

The 390×844 profile is the **same browser with a mobile viewport override**, not a separate phone CPU, GPU or cellular connection. No statistically established production SLA or forecast-skill comparison was attempted. Visual responsiveness and input-to-paint latency remain separate acceptance work.

## Consistency and visual checks

- The same image bytes, corner coordinates, publisher palette, inches, issue time and valid interval pass one fingerprint check before a map/evidence commit.
- Requested time is labeled separately while the previous dated frame remains displayed. A superseded result cannot replace the newer selection.
- Millerton and Pine Flat share the regional forecast while retaining their own watershed selection and existing, individually dated gauge/reservoir context.
- Six-hour and 72-hour products retain their **different publisher issue times**. They are not relabeled as a common model run.
- An absent frame fails; a verified response without contours stays explicitly different from zero rain or safe conditions.
- Some shared reference-tile warnings appeared. The laboratory keeps them visible and does not count map startup/paint as successful weather-data delivery. This is not a comprehensive map or phone usability certification.

## Artifacts and reproduction

The original captures, trial JSON and screenshots stay under ignored `work/weather-delivery/`. Publication was subsequently authorized on November 25: release 0.101.0 includes an allowlisted public replay on Pages. Trial logs, screenshots, acquisition logs and other work files remain excluded. See `docs/weather-delivery-publishing.md`. The comparison route is not linked from operator navigation. No AGOL/private data or permissions change.

On Windows PowerShell, from the repository root:

```powershell
node --use-system-ca scripts/capture-weather-replay.mjs
$env:WEATHER_LAB_LATENCY_MS = '80'
$env:WEATHER_LAB_PORT = '8779'
node scripts/serve-weather-lab.mjs
```

Open `http://127.0.0.1:8779/weather-delivery.html`, then **Run five paired trials**. Stop that server with Ctrl+C. Set latency to `0` for the no-imposed-delay profile. Capturing again obtains a different recorded weather revision; keep the prior capture directory to reproduce these exact inputs. The server binds only to loopback and streams bounded byte ranges rather than reading a full PMTiles archive per range.

Validation: **1,073 JavaScript tests passed**, Command typecheck/build passed, generated import maps are current, and source/data/link checks passed. Independent review identified the timer boundary issue; it was fixed and measurements rerun.

## Recommended next increment

Integrate prepared **rainfall display frames first**, behind an opt-in Command flag. A scheduled public-data producer should validate each forecast revision and publish immutable images with an atomic manifest, separately from app deployment. The runtime needs explicit freshness/expiry policy and direct-service fallback; this recorded-replay manifest must never be treated as a live source. Test that deployment on County equipment and the intended object-storage/CDN path before changing the default.

Then apply the same evidence contract to gust and snowfall delivery, one product at a time. Keep radar/GOES observations separate and dated. Retain numerical COG/Zarr products when numerical analysis requires them; these PNG display assets are not GeoParquet, numerical rainfall grids, inundation predictions or a new model. There is no evidence from this experiment that another renderer rewrite is needed.
