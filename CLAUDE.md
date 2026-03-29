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
- `src/components/CanvasClusterLayer.ts` — canvas-based cluster renderer (Supercluster + single `<canvas>`, default)
- `src/components/DefectMarkers.ts` — DOM-based cluster renderer (leaflet.markercluster + L.divIcon)
- `src/utils/generateDefects.ts` — random defect data generator
- `src/types.ts` — shared TypeScript interfaces

A **Canvas / Leaflet toggle chip** (top-right) switches between renderers at runtime. Canvas is the default. See `docs/performance-investigation.md` for the full performance context.
