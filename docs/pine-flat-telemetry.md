# Pine Flat resilience and downstream evidence — 0.76.0

## Investigation, 2026-11-14

CDEC PNF sensor 6 hourly resumed reporting during investigation: 755.63 ft at
07:00 PST. The USACE Pine Flat hourly report agreed. The former stale reading
was not evidence that the pool stayed unchanged. Freshness limits remain 3 h;
the collector's 45-minute and gauge observation's 2-hour limits remain explicit.
No publisher delivery guarantee can be created by the app.

## Public sources and contracts

- Primary pool: https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=PNF —
  sensor 6, H, FEET; CDEC JSON wall times are fixed PST.
- Cross-check: https://www.spk-wc.usace.army.mil/fcgi-bin/hourly.py?report=pnf
- NWS station metadata: https://hads.ncep.noaa.gov/hsas/HNX_dcps.shtml
- Pool telemetry: PFTC1 / CE94E43C / HP.
- Below-dam gauge: PFQC1 / CE94F74A / HG, 36.830556, -119.336111 (WGS84
  display coordinates derived from publisher DMS). USACE-operated telemetry,
  distributed by NWS HADS; provisional and not quality controlled by HADS.
- Decoded source URL pattern:
  `https://hads.ncep.noaa.gov/nexhads2/servlet/DecodedData?sinceday=-48&nwslis=PFQC1&hsa=nil&state=nil&of=1`
  Returns pipe-delimited records. Negative sinceday requests previous hours;
  observed 48-hour response checked. Time is UTC; stage/pool contracts use feet.
  Live PFQC1 HG at 16:00 UTC matched USACE outflow stage at 08:00 PST: 1.53 ft.
  PFTC1 hourly values agreed with CDEC across 47 same-time observations within
  0.02 ft in this check. Temperature and voltage columns are never interpreted
  as stage. Original observation and collection times stay separate.

The scheduled reservoir collector now retrieves both HADS sources independently,
with bounded timeouts, stable identities, explicit failures and last-success
times. Existing 15-minute Pages schedule is a target, not guaranteed delivery.
Failed downloads retain dated history; they cannot create a current trend.

Pool backup is a separate source series, not spliced into CDEC history. It is
eligible only when CDEC is unusable, identities/units still match, HADS is current,
the latest record is unflagged, and recent same-time values agree with CDEC within
0.02 ft. Hour-aligned HADS samples supply its own one-hour comparison. This
tolerance is a feed consistency check, not a hydrologic action threshold.
Backup use is labeled and linked. CDEC source-health failure remains visible.
If overlap is absent/conflicting, both sources are old, or timestamps/units change,
the pool remains unverified. The two distribution paths share underlying
telemetry; this is delivery resilience, not an independent sensor or guarantee.

PFQC1 feeds Kings-lower Area Watch, its existing observed-rise rule, the review
banner, captured briefing evidence and Pine Flat's release/stage chart. It has
no configured flood thresholds, discharge series or forecast. Stage uses a
separate ft axis from releases in cfs. The gauge's own datum is not supplied.
It is near the dam, not coverage of all of the lower Kings; routing, diversions,
arrival times and farther-downstream conditions need operator verification.
USGS 11221500 is historical; upstream Trimmer and North Fork are not substitutes.

## Interface

County Watch now starts with the attention queue. Reference inventories and
historical storm reports remain below it; the historical block starts collapsed.
Queue rows show the review reason and relevant timing. Selection opens a compact
pool/release/rain/gauge grid with units, source dates and unknown states visible.
Detailed provenance, gauge forecasts and connection limits are expandable.
Live monitoring does not silently rewrite captured briefing evidence.

## Verification

Parser tests cover identity/variable mismatch, UTC, blanks, flags, conflicts,
missing sources and aged checks. Integration tests cover observed-only review
cues, source failure, fallback agreement and frozen briefings. Live source check
and desktop Chrome preview confirmed Pine Flat 170 cfs, pool 755.63 ft, downstream
stage 1.53 ft and the WPC rainfall window, each with its own observation time.
