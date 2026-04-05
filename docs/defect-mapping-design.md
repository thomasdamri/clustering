# Defect-to-Fitting-Position Mapping — Design & Implementation Plan

## Context

The diagram viewer currently uses randomly generated defects (`generateDefects()`). The goal is to replace this with real defect data from a Cognos database extract, correctly mapped to fitting positions (`fit_structure_id`) on the diagram.

The core challenge is that `F_Defect` does not consistently reference a reliable identifier for fitting position — the `fit_structure_id` field is free text with poor data quality, and fallback identifiers (`asset_id`, `equipment_id`) require multi-step joins that may resolve to non-leaf (non-diagram) nodes in the fit structure hierarchy.

---

## Design

### API Contract

A new backend API endpoint:

```
GET /api/defects
```

Returns:

```ts
interface ResolvedDefect {
  defectId: string;
  fittingPos: string;       // fit_structure_id e.g. "FV0001"
  description: string;
  severity: 'High' | 'Med' | 'Low';
  multiPos?: true;          // present if duplicated across multiple positions
}

interface UnresolvedDefect {
  defectId: string;
  unresolved: true;
  rawFitStructureId?: string;
  assetId?: string;
  equipmentId?: string;
}

interface DefectsResponse {
  resolved: ResolvedDefect[];
  unresolved: UnresolvedDefect[];
  unresolvedCount: number;
}
```

### Resolution Waterfall

Per defect, try in order, stop at first success:

1. **Free-text parse** — tokenize `fit_structure_id` (split on `,` `;` `/` whitespace), normalize (trim, uppercase), validate each token against known-labels set. If 1+ valid tokens → resolve to all (set `multiPos: true` if >1).
2. **Asset join** — if `asset_id` present: query `F_Fitted_Asset` where `asset_id` matches, filter to leaf nodes only (where `fit_position` is not null), resolve to all distinct `fit_structure_id` values.
3. **Equipment chain** — if `equipment_id` present: query `F_Equipment` to get `asset_id`, then apply Step 2 logic.
4. **Unresolved** — emit to `unresolved[]` with raw identifiers.

The known-labels set is authoritative — any token not in it is treated as garbage.

### Multi-Position Clustering Behaviour

- Defects resolved to multiple positions appear as a marker at **each** position.
- Cluster **counts deduplicate by `defectId`** — a defect spanning 3 nearby positions counts as 1, not 3.
- The defect list panel (ClusterOverlay) also deduplicates by `defectId` — the defect appears once.
- `multiPos: true` flag enables optional "also linked to: FV0002" annotation in the detail panel.

### Frontend Changes (minimal)

**`src/types.ts`** — add `multiPos` field:
```ts
export interface Defect {
  defectId: string;
  fittingPos: string;
  description: string;
  severity: Severity;
  multiPos?: true;   // NEW
}
```

**`src/App.tsx`** — replace `generateDefects()` call with API fetch:
```ts
// Replace:
const defects = generateDefects(manifest.hitboxes);
// With:
const res = await fetch('/api/defects');
const data: DefectsResponse = await res.json();
const defects = data.resolved;
// Optionally surface: data.unresolvedCount
```

Optionally show `unresolvedCount` as a small chip in the UI.

**Cluster renderers** — deduplicate by `defectId` when computing counts and building defect lists.

---

## Implementation Steps

### Step 1 — Update `src/types.ts`
Add `multiPos?: true` to the `Defect` interface.

### Step 2 — Update cluster renderers for deduplication
In `CanvasClusterLayer.ts` and `DefectMarkers.ts`, deduplicate by `defectId` when:
- Computing the count displayed on a cluster marker
- Building the `defects[]` array passed to `onClusterClick`

### Step 3 — Update `ClusterOverlay.tsx` (optional multiPos annotation)
In the defect list panel, if `defect.multiPos` is true, show a note like "linked to multiple positions".

### Step 4 — Create API layer (technology TBD)
Implement `GET /api/defects` with the waterfall resolver:
- Load known-labels set on startup
- Query `F_Defect`, `F_Fitted_Asset`, `F_Equipment` from Cognos
- Run waterfall per defect, emit `ResolvedDefect[]` and `UnresolvedDefect[]`

### Step 5 — Update `src/App.tsx`
Replace `generateDefects()` with `fetch('/api/defects')`. Optionally surface `unresolvedCount`.

### Step 6 — Integration test
- Verify resolved defects appear at correct positions on diagram
- Verify a multi-position defect appears at each position but counts as 1 in cluster
- Verify unresolved defects are excluded from the map but counted
- Check no regression in canvas/leaflet toggle

---

## Verification

1. `npm run dev` — map loads, defect markers appear
2. Click a cluster containing a multi-position defect — it appears once in the list, `multiPos` visible
3. Check cluster count over a region with known multi-pos defects — count reflects unique defect IDs
4. Check browser console / API response for `unresolvedCount` — non-zero expected with real data
5. `npm run build` — TypeScript check passes
