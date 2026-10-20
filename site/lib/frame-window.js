// Depth frames as MediaLayer elements, but only the ones on screen (plus the next one) are in the layer at a time.
// A scenario has up to ~60 frames of 2600 px; with every frame in the layer, decoded images reached ~870 MB and
// crashed phone browsers. Removed frames are dropped; the browser's HTTP cache makes re-adding them cheap.

/**
 * elements: the layer's element collection (add/remove); makeElement(i) builds frame i; count: number of frames.
 * Returns show(i0, i1, w): frames i0 and i1 cross-faded by w, frame i1 + 1 preloaded at opacity 0.
 */
export function createFrameWindow(elements, makeElement, count) {
  const live = new Map();
  return function show(i0, i1, w) {
    const keep = new Set([i0, i1, Math.min(i1 + 1, count - 1)]);
    for (const [i, el] of live) if (!keep.has(i)) { elements.remove(el); live.delete(i); }
    for (const i of keep) if (!live.has(i)) { const el = makeElement(i); live.set(i, el); elements.add(el); }
    for (const [i, el] of live) el.opacity = i === i0 ? 1 - w : i === i1 && i1 !== i0 ? w : 0;
  };
}
