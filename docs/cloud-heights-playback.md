# Inspectable cloud tops and steadier playback — 0.93.0

County Watch → Reference & coordination → Millerton or Pine Flat watershed → Map → Hanford radar.

Hover over a retrieved cloud surface or select it to see approximate cloud-top altitude in feet and kilometres, plus the GOES observation time. The compact three-class altitude key appears only with the 3D height product. Colors describe altitude, not storm severity. The popup distinguishes geopotential altitude from height above local terrain. Gauges, roads and facilities retain selection priority.

The pick intersects the actual rendered triangle using the current camera matrix. It returns the nearest visible triangle and barycentric altitude; no nearest-point filling of missing retrievals. Picking is disabled during camera movement, unrendered replacements and two-observation fades. Missing cells, masked retrievals, terrain-hidden surfaces and the 2D infrared fallback do not acquire height readings. The surface is an approximate triangulated NOAA retrieval, not cloud-base height, thickness or photogrammetric cloud geometry; satellite parallax remains a limitation.

Radar patches, experimental Zarr volumes and GOES surfaces now accept a 400 ms opacity crossfade. Forward radar transitions are limited to gaps of ten minutes; cloud observations must remain within the existing 20-minute pairing window. Backward seeks, reduced-motion preference and large gaps switch immediately. Both observation times are labeled while blending; no heights, reflectivity values, intermediate storm positions or trajectories are calculated from the fade. Readings pause during the blend to avoid presenting mixed observations as a measured height.

Two upcoming scans are prepared in bounded, memory-only caches. Slow cloud retrievals do not block preparation of the second radar scan. Patches retain at most 12 decoded frames, volumes three and cloud surfaces/images four; each graphics renderer holds at most two display frames. The loop waits 1.1 seconds after each frame is ready. Slow or failed sources can still delay it; this is not a guaranteed video frame rate. Pause, source changes and hidden pages abort pending work while retaining completed lookahead. Closing clears the cache. Failed replacements retain dated evidence; cloud rendering failure tries independently dated 2D infrared and hides the altitude key.

Verification: 938 JavaScript tests pass, including view-matrix picking, missing data, terrain occlusion, two-frame resource limits, graphics-state restoration, cancellation, reduced motion, failure fallback and cloud transition timestamps. Deployment syntax/data/link checks pass. The local browser displayed current NOAA retrievals, hover and click heights, the compact key at 1280×720 and 390×844, and completed both patch and volume replay. Phone-sized testing uses browser click input; actual touch hardware and dense-storm performance remain field checks. No 60-fps claim is made.

The source is NOAA GOES-18 ABI-L2-ACHA2KMC. [NOAA product metadata](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc%3AC01505) describes cloud-top geopotential height. Source scan links and quality/timing qualifications remain in the map's Sources section.

No storage permissions, operational records or alert thresholds change. Rollback: redeploy 0.92.0; no migration.
