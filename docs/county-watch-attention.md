# County Watch attention workflow — 0.78.0

County Watch now starts with Needs attention: five concern records per page, existing category filters and a plain-language next review. Existing domain rules and ordering select the records; this is not a new risk score or an incident count. The countywide notification strip stays independent of map focus and filtering.

A selected concern controls the map and evidence. River reviews show their configured watchpoints and explicitly associated utility/road/facility records. Other queue types focus their selected entity; resident-care zones are limited to the source-matched zone IDs. These are source points and associations, not an inferred hazard boundary. Selected building overlays cannot linger in unrelated river reviews. Source eligibility still controls access, and logout clears the selected private concern.

Explore map reveals the topic tabs, search, layer menu, basemap/3D controls and other map tools. Return to focused view restores the same selected concern. Selecting another queue item returns to focus. Existing topic URLs and explicit population/DWR/reference links remain usable. Map preferences and all focus state remain in memory.

River evidence leads with the review cue, requested verification, Assign follow-up (or Sign in to assign), Add to briefing, and key reservoir/rainfall/gauge values. Map/3D/trend controls and technical tools are expandable. Provenance, stale/unknown labels, missing forecasts, unverified connections and source timestamps remain available. Reference and coordination content is a collapsed disclosure; it remains in the DOM for the existing controllers.

Phone behavior: attention list first, selected concern opens map/evidence, Attention list returns to the list. Desktop retains list/map/evidence columns. The browser connection failed during the second visual pass: initial desktop layout and Pine Flat selection were visually checked; final responsive visuals and new private-account flows have not been interactively rechecked in this session. Automated tests cover mobile list/map navigation, focus/explore switching, source eligibility, entity filtering, private-selection clearing and reference-link behavior.

Collectors, assessment thresholds, permissions, approved messages, briefing snapshot semantics and schemas are unchanged. No data migration. Rollback is redeployment of 0.77.0.
