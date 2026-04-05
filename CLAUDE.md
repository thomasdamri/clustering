# Cluster — Tiled Diagram Viewer POC

## Overview

POC for a Leaflet-based tiled engineering diagram viewer with defect overlay markers.

## Tech Stack

- React 19, TypeScript 5.9, Vite 8
- Leaflet JS (vanilla, not react-leaflet) + leaflet.markercluster + supercluster
- MUI (Material UI) for UI components

## Key Data Files (in `/public`)

- `label-manifest.json` (13MB) — 2000 hitboxes with fitting position labels + multi-format coordinates (DXF, SVG, PNG, Leaflet)
- `tile_meta.json` — tile metadata (max_zoom: 5, tile_size: 256, bounds)
- `transform.json` — coordinate system transformations

## Tiles

- Path: `/public/tilles/{z}/{x}/{y}.webp`
- 6 zoom levels (0–5), 256px tiles, ~9,730 WebP files
- Full image: 30,000 x 4,222 px

## Coordinate System

- Leaflet `CRS.Simple` (custom image, not geographic)
- Bounds: `[[-256, 0], [0, 1819.0431]]`

## Commands

- `npm run dev` — start dev server
- `npm run build` — TypeScript check + Vite build
- `npm run lint` — ESLint
- `npm run preview` — preview production build

## Architecture

- `src/components/MapViewer.tsx` — vanilla Leaflet map init via useRef/useEffect
- `src/components/CanvasClusterLayer.ts` — canvas-based cluster renderer (Supercluster + single `<canvas>`, default), implements `ClusterLayerHandle`
- `src/components/DefectMarkers.ts` — DOM-based cluster renderer (leaflet.markercluster + L.divIcon), returns `ClusterLayerHandle`
- `src/components/ClusterOverlay.tsx` — MUI Popper (cursor-following tooltip) + Popover (defect list panel) rendered via virtual anchor elements
- `src/utils/generateDefects.ts` — random defect data generator (includes severity: High/Med/Low)
- `src/types.ts` — shared TypeScript interfaces

**Interaction pattern:** Both renderers fire `LayerCallbacks` (onHover, onHoverEnd, onClusterClick, onDismiss) into React state in `App.tsx`. `ClusterOverlay` renders MUI components positioned at screen coordinates via virtual anchor elements (objects with `getBoundingClientRect()`). A **Canvas / Leaflet toggle chip** (top-right) switches between renderers at runtime. Canvas is the default. See `docs/performance-investigation.md` for the full performance context.

## Canvas Cluster Layer — Key Patterns

### Zoom animation timing

- The canvas sits outside Leaflet's CSS tile-pane transform — it does NOT scale with the map during zoom animation.
- Use `zoomanim` (fires at animation START, `e.zoom`/`e.center` are the target values) to start cluster animations concurrently with the map zoom. `zoomend` fires after animation completes — too late.
- Guard with a `_zoomAnimFired` flag: set in `zoomanim`, checked in `zoomend` to avoid double-animating. `zoomanim` does not fire for programmatic/non-animated zooms, so `zoomend` must handle that fallback.
- Computing positions before the map has moved: use `map.project(latlng, targetZoom)` / `map.unproject(pt, targetZoom)` — NOT `latLngToContainerPoint`, which always uses the current zoom.

### Supercluster parent/child matching

- To determine which clusters merge/split during zoom, use `sc.getLeaves(clusterId, Infinity)` to get all leaf points under a cluster, then match by leaf position key (`p:{position}`). This reflects supercluster's actual R-tree grouping.
- Do NOT use nearest-neighbour screen distance — spatially close ≠ same cluster membership.
- `getLeaves` is fully recursive so it handles multi-level zoom jumps correctly. `getChildren` only gives direct children one zoom level up — avoid it for animation matching.
- Supercluster `maxZoom` is set to 3 (`CanvasClusterLayer` constructor). At zoom ≥ 4 clustering is disabled.

### Fractional zoom (zoomSnap: 0.25, zoomDelta: 0.5)

- `zoomanim`/`zoomend` fire on every 0.25-step snap. Always `Math.round(map.getZoom())` before passing to `sc.getClusters()` — supercluster only accepts integer zoom levels.
- Many consecutive zoom events may not change the cluster layout at all (multiple fractional steps round to the same integer).
