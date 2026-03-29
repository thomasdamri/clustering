# Public Data Files Reference

Documentation for the JSON data files in `/public` used by the tile viewer app.

---

## `tile_meta.json`

Metadata about the tile layer. Loaded by `App.tsx` and passed to `MapViewer.tsx`.

| Field | Type | Used | Description |
|-------|------|------|-------------|
| `max_zoom` | `number` | **Yes** | Maximum zoom level Leaflet will render (0–5). Passed as `maxZoom` to the Leaflet map and tile layer. |
| `tile_size` | `number` | **Yes** | Pixel width/height of each tile (256). Passed as `tileSize` to the Leaflet tile layer. |
| `leaflet_bounds` | `[[lat, lng], [lat, lng]]` | **Yes** | Southwest/northeast bounds of the full image in Leaflet coordinates. Used to constrain panning (`maxBounds`) and to fit the initial view. |
| `full_width_px` | `number` | No | Full image width in pixels (30,000). Not read by the app. |
| `full_height_px` | `number` | No | Full image height in pixels (4,222). Not read by the app. |
| `svg_viewbox_width` | `number` | No | Width of the SVG viewbox used when generating tiles. Not read by the app. |
| `svg_viewbox_height` | `number` | No | Height of the SVG viewbox used when generating tiles. Not read by the app. |
| `px_per_svg_unit` | `number` | No | Pixels per SVG coordinate unit. Useful for converting SVG coords to pixel coords but not used by the app. |
| `px_per_dxf_unit` | `number` | No | Pixels per DXF coordinate unit. Useful for converting DXF coords to pixel coords but not used by the app. |

---

## `transform.json`

Coordinate system transformation parameters produced by the tile generation pipeline. **Not used by the app** — all needed transform data is embedded inside `label-manifest.json`.

| Field | Type | Description |
|-------|------|-------------|
| `dxf.x_min/y_min/x_max/y_max` | `number` | Bounding box of the source DXF drawing in DXF units. |
| `dxf.width/height` | `number` | Dimensions of the DXF drawing in DXF units. |
| `svg.viewbox_x/y/w/h` | `number` | SVG viewBox values used when the DXF was rendered to SVG. |
| `png.width_px/height_px` | `number` | Final raster image dimensions in pixels. |
| `scale_x` | `number` | Horizontal scale factor: SVG units per DXF unit. |
| `scale_y` | `number` | Vertical scale factor: SVG units per DXF unit. |
| `tile_size` | `number` | Tile size in pixels (256). |
| `leaflet_bounds` | `[[lat, lng], [lat, lng]]` | Same bounds as in `tile_meta.json`. |

---

## `label-manifest.json`

The main data file (~13 MB, ~2,000 hitboxes). Contains every fitting position label extracted from the source DXF, with its location in all four coordinate systems and bounding box geometry. Loaded by `App.tsx`.

### Top-level fields

| Field | Type | Used | Description |
|-------|------|------|-------------|
| `version` | `string` | No | Schema version of this manifest file (e.g. `"1.3"`). |
| `source_dxf` | `string` | No | Filename of the DXF file that was processed to produce this manifest. |
| `source_svg` | `string` | No | Filename of the intermediate SVG file. |
| `generated_at` | `string` | No | ISO 8601 timestamp of when the manifest was generated. |
| `layer_priority` | `string[]` | No | Ordered list of DXF layers used when resolving duplicate labels (e.g. `["TAGS", "EQUIP", "ANNO", "TEXT"]`). |
| `transform` | `object` | No | Copy of `transform.json` embedded for self-containment. See `transform.json` table above for field descriptions. |
| `hitboxes` | `Hitbox[]` | **Yes** | Array of fitting position hitbox objects. See below. |

### `hitboxes[]` — per-hitbox fields

Each hitbox represents one fitting position label found in the diagram.

#### Identity

| Field | Type | Used | Description |
|-------|------|------|-------------|
| `label` | `string` | **Yes** | The fitting position identifier (e.g. `"FV0001"`). Used as the marker label and as the key linking hitboxes to defects. |
| `found` | `boolean` | **Yes** | Whether a matching position label was confidently located in the DXF. Hitboxes with `found: false` are excluded when generating defect markers. |

#### Point coordinates (label centre)

| Field | Type | Used | Description |
|-------|------|------|-------------|
| `dxf.x/y` | `number` | No | Centre of the label text in DXF coordinate units. |
| `svg.x/y` | `number` | No | Centre of the label in SVG viewBox units. |
| `leaflet.lat/lng` | `number` | **Yes** | Centre of the label in Leaflet `CRS.Simple` coordinates. Used to place the defect marker on the map. |

#### Bounding box — `bbox`

Full bounding box geometry for the label in each coordinate system. Contains `x, y, width, height, cx, cy, corners[]` in DXF, SVG, and PNG systems, and `bounds, corners[], center` in the Leaflet system. **None of the bbox fields are currently read by the app.** They are available for hit-testing, zoom-to-fit, or highlighting the label region.

| Sub-object | Used | Description |
|------------|------|-------------|
| `bbox.dxf` | No | Bounding box in DXF units. |
| `bbox.svg` | No | Bounding box in SVG viewBox units. |
| `bbox.png` | No | Bounding box in pixel (PNG) units. |
| `bbox.leaflet.bounds` | No | `[[minLat, minLng], [maxLat, maxLng]]` — axis-aligned bounding box in Leaflet coords. |
| `bbox.leaflet.corners` | No | Four corner points as `{lat, lng}` objects (useful if the label is rotated). |
| `bbox.leaflet.center` | No | Centre of the bounding box in Leaflet coords (may differ from `leaflet.lat/lng` for rotated labels). |

#### Metadata — `meta`

| Field | Type | Used | Description |
|-------|------|------|-------------|
| `meta.layer` | `string` | No | DXF layer this label was found on (e.g. `"TEXT-ALL"`). |
| `meta.type` | `string` | No | DXF entity type (e.g. `"TEXT"` or `"MTEXT"`). |
| `meta.handle` | `string` | No | DXF entity handle — unique identifier within the DXF file. |
| `meta.duplicate` | `boolean` | No | `true` if the same label string appeared more than once; this entry was chosen by layer priority. |
| `meta.fuzzy_match` | `boolean` | No | `true` if the label was matched via fuzzy string matching rather than an exact match. |
| `meta.clustered` | `boolean` | No | `true` if this hitbox was merged from multiple nearby text fragments. |
| `meta.cluster_parts` | `array` | No | The individual text fragments that were merged to form this label (populated when `clustered: true`). |
