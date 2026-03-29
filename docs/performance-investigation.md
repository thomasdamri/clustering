# Performance Investigation: Slow Laptop Drag FPS

## Goal

Ensure the app is usable on slow laptops. Testing methodology: 4x CPU throttle in Chrome DevTools Performance panel with Frame Rendering Stats overlay enabled.

**Baseline:** 3 FPS during fast drag at 4x CPU throttle.
**Current state:** Smooth drag at 4x throttle, regardless of zoom level.

---

## Key Finding: DevTools Throttle Behaviour

The 4x CPU throttle in Chrome DevTools is **only fully active while a Performance recording is in progress**. When you stop recording (but stay in the Performance panel), the throttle setting persists but its real-world effect is inconsistent. This means:

- "Feels fast while recording" does not mean it's fast — it means the recorder's own overhead is masking the problem.
- To validate fixes, check the **frame timeline in the recording itself**, not subjective feel during recording.
- To simulate a real slow laptop without recording, test on actual hardware.

---

## Bugs Fixed

### 1. CSS `transition: transform` on cluster markers — PRIMARY drag bottleneck

**File:** `src/index.css`

**Problem:** `.defect-cluster` had `transition: transform 120ms ease` in its rule. Leaflet positions every marker by writing `transform: translate3d(x, y, 0)` directly on each element's style on every drag frame. With a CSS transition on `transform`, the browser kicks off a 120ms animation for every position update on every visible cluster icon. At 246–441 visible cluster elements, this caused 50–100 concurrent CSS animations per drag frame.

**Fix:** Removed `transform` from the transition list on `.defect-cluster`. Moved the hover `scale(1.08)` effect to the inner `<div>` child element, so it has its own independent transition that doesn't interfere with Leaflet's positioning transform on the outer element.

```css
/* Before */
.defect-cluster {
  transition: transform 120ms ease, background 120ms ease, ...;
}
.defect-cluster:hover { transform: scale(1.08); }

/* After */
.defect-cluster {
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.defect-cluster div { transition: transform 120ms ease; }
.defect-cluster:hover > div { transform: scale(1.08); }
```

---

### 2. Hit-testing and `:hover` recalcs on every `mousemove` — secondary drag bottleneck

**File:** `src/components/MapViewer.tsx`

**Identified via:** DevTools flame chart showed "Hit test" and "Recalculate style" as the dominant tasks inside long drag frames. The element count was 308 at the time of identification.

**Problem:** On every `mousemove` during drag, the browser hit-tests all visible cluster elements (308+) to determine which one is under the cursor. Each `.defect-cluster` uses `border-radius: 50%`, making hit-testing more expensive than rectangles (requires circular clip path evaluation per element). After each hit test, `:hover` pseudo-class state potentially changes on elements, triggering a style recalculation pass.

**Fix:** On `dragstart`, set `pointer-events: none` on the Leaflet `markerPane`. Restore on `dragend`. Markers are not interactive during drag anyway.

```typescript
const markerPane = map.getPane('markerPane');
map.on('dragstart', () => { if (markerPane) markerPane.style.pointerEvents = 'none'; });
map.on('dragend',   () => { if (markerPane) markerPane.style.pointerEvents = ''; });
```

---

### 3. DOM count still too high at max zoom — compositing cost

**File:** `src/components/DefectMarkers.ts`

**Problem:** Element counts by zoom level: 6 → 22 → 82 → 246 → 441. Above ~100 cluster elements, compositing overhead during drag causes frame drops even with hit-testing and CSS transitions fixed. The browser must composite all visible elements every frame.

**Partial fix:** Increased `maxClusterRadius` from 30 to 60 pixels. More aggressive clustering reduces visible icon count at each zoom level.

**Remaining issue at high zoom (246–441 elements):** See item 4 below.

---

### 4. markercluster `_moveEnd` blocking main thread on drag release — 211ms freeze

**File:** `src/components/MapViewer.tsx`

**Identified via:** Performance recording showed a 211ms long frame (red striped in Frames row) coinciding with `Event: mouseup`. Flame chart showed `On ign...node(s)` (markercluster's `_recursivelyAddChildrenToMap`) and `Recalculate style` inside the task.

**Problem:** When drag ends, Leaflet fires `moveend`. markercluster's `_moveEnd` handler fires synchronously and recursively traverses all 441 markers to determine which ones should be visible in the new viewport. Under 4x CPU throttle with 441 markers, this took 211ms. This blocks the main thread — the app is unresponsive for 211ms after every drag release.

**Fix (current, under review):** On `dragstart`, set `visibility: hidden` on both `markerPane` and `popupPane`. Restore on `dragend`. This does two things:

1. Eliminates all compositing cost during drag (zero GPU work — `visibility: hidden` removes from render tree, unlike `opacity: 0` which still composites).
2. The 211ms `_moveEnd` freeze after drag release is hidden from the user — markers were already hidden, so they just see markers appear with a brief delay rather than feeling a main-thread stutter.

`popupPane` is also hidden to prevent any open popup from floating disconnected during pan.

**⚠️ UX concern — not signed off:** Hiding markers during drag solves the performance problem but is a product decision that hasn't been validated. Users can't see defect locations while navigating, which may or may not be acceptable depending on how the tool is used. The fix is in place for now to unblock performance testing, but the approach should be reconsidered. See "Remaining Limitations" for alternatives.

```typescript
const markerPane = map.getPane('markerPane');
const popupPane  = map.getPane('popupPane');
const onDragStart = () => {
  if (markerPane) markerPane.style.visibility = 'hidden';
  if (popupPane)  popupPane.style.visibility  = 'hidden';
};
const onDragEnd = () => {
  if (markerPane) markerPane.style.visibility = '';
  if (popupPane)  popupPane.style.visibility  = '';
};
map.on('dragstart', onDragStart);
map.on('dragend',   onDragEnd);
```

---

### 5. Event listener leaks in `createDefectLayer`

**File:** `src/components/DefectMarkers.ts`

**Problem:** Two listeners were registered and never cleaned up:

- `document.addEventListener('keydown', ...)` — anonymous function, impossible to remove
- `map.on('movestart', clearClusterTooltip)` — never removed

If `createDefectLayer` were ever called more than once (e.g. after a manifest reload), listeners would accumulate.

**Fix:** Named the `keydown` handler. Added a single `cluster.on('remove', ...)` handler that cleans up both when the layer is removed from the map.

---

### 6. Cluster animation enabled (zoom performance)

**File:** `src/components/DefectMarkers.ts`

**Fix:** Added `animate: false` to `L.markerClusterGroup` options. Disables CSS transitions on cluster icon formation/dissolution during zoom. Reduces style-recalculation overhead during zoom gestures on slow hardware. No effect on drag FPS.

---

## False Lead: `updateWhenIdle`

Early hypothesis: the primary drag bottleneck was WebP tile decoding during pan. `updateWhenIdle: true` was added to the tile layer to defer tile loading until drag ends.

**Disproven by:** Commenting out `layer.addTo(map)` (removing all markers) made drag fast even without `updateWhenIdle`. Tiles were not the bottleneck — markers were. The option was reverted.

**Later re-added:** Once the marker bottleneck was solved, `updateWhenIdle: true` was added back as a secondary optimisation — no reason to decode tiles during drag when the user can't read them.

---

## False Lead: `will-change: transform` on cluster icons

Added `will-change: transform` to `.defect-cluster` to promote each element to its own compositor layer, expecting this to speed up per-element repositioning.

**Removed because:** During drag, all cluster icons move together as a single Leaflet pane. They don't need individual compositor layers — the pane's single CSS transform moves them all. Having 100–400 individual compositor layers would increase GPU memory pressure and compositing overhead, not reduce it.

---

## Current State of Changed Files

### `src/components/MapViewer.tsx`

- `updateWhenIdle: true` on tile layer
- `dragstart`/`dragend` handlers: hide/show `markerPane` and `popupPane` via `visibility`

### `src/components/DefectMarkers.ts`

- `maxClusterRadius: 60` (up from 30)
- `animate: false` on `L.markerClusterGroup`
- Named `keydown` handler + `cluster.on('remove')` cleanup for `keydown` and `movestart` listeners

### `src/index.css`

- `transition: transform` removed from `.defect-cluster`
- Hover scale moved to `.defect-cluster > div` with its own `transition: transform`

---

## Known Remaining Limitations

**The 211ms `_moveEnd` freeze is masked, not eliminated.** The main thread is still blocked for ~50–200ms after each drag release (scales with marker count and CPU speed). On actual slow hardware this may be noticeable as a brief delay before markers appear. If this becomes a problem, options are:

- **Wrap `_moveEnd` in `setTimeout(fn, 0)`** to defer it past the next rendered frame, so at least one frame renders after drag release before the freeze hits.
- **Canvas-based marker rendering** — replace `L.divIcon` DOM elements with a single `<canvas>` overlay. Eliminates the DOM element count problem entirely and makes `_moveEnd` irrelevant. **This has been implemented — see below.**
- **Reduce total marker count** — fewer markers in the cluster tree = faster `_moveEnd` traversal.

---

## Long-term Solution: Canvas Rendering (implemented)

**Branch:** `canvas-cluster-rendering`

Replaced `leaflet.markercluster` + `L.divIcon` DOM elements with a single `<canvas>` overlay layer (`src/components/CanvasClusterLayer.ts`). This is the industry-standard approach used by Google Maps, Mapbox, and deck.gl.

### What changed

- **`CanvasClusterLayer`** — custom `L.Layer` subclass. Owns a single `<canvas>` element positioned over the map. Zero DOM elements per cluster marker.
- **Supercluster** (Mapbox's npm package) replaces markercluster's internal tree. Uses an R-tree; `getClusters(bbox, zoom)` completes in <1ms regardless of marker count. The 211ms `_moveEnd` freeze is **eliminated**, not masked.
- **Canvas redraws every rAF during drag** via `map.on('move', scheduleRedraw)` — markers track the map live, always visible, no compositing overhead from individual DOM elements.
- **All drag workarounds removed** — the `visibility: hidden` hack in `MapViewer.tsx` is gone entirely.
- **Hit-testing** — O(n) distance² check against stored circle positions on `mousemove`. Cheaper than browser DOM hit-testing through circular `border-radius` clips.
- **HiDPI** — canvas sized at `width × devicePixelRatio`, scaled once after resize.

### Result

Smooth drag at 4× CPU throttle at all zoom levels with markers always visible. No main-thread freeze on drag release.

### Comparing modes

A **Canvas / Leaflet toggle chip** in the top-right corner of the UI lets you switch between the two implementations at runtime. This makes it easy to demonstrate the performance difference side-by-side in the same session.

### Files

| File | Role |
| --- | --- |
| `src/components/CanvasClusterLayer.ts` | Canvas renderer (new) |
| `src/components/DefectMarkers.ts` | DOM renderer (original, kept for comparison) |
| `src/App.tsx` | Mode state + layer lifecycle + toggle chip |
