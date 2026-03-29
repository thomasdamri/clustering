# Cluster Marker — Component Brief

## Context

Part of a React/TypeScript engine diagram viewer. The diagram is a P&ID rendered on a pannable/zoomable canvas (`react-zoom-pan-pinch`). Cluster markers are overlaid on the canvas to represent groups of historic defects spatially associated with fittings on the diagram.

The app uses Material Design 3 via MUI.

---

## What a cluster is

A cluster is a group of one or more defects associated with a region of the diagram. At high zoom levels a cluster may map to a single fitting; at low zoom levels one cluster may span many fittings. Clusters are computed externally and passed in as props — the component is not responsible for grouping logic.

---

## Size variants

Determined by defect count. Four steps:

| Variant | Count | Diameter |
| ------- | ----- | -------- |
| Small   | 1     | 28px     |
| Medium  | 2–5   | 36px     |
| Large   | 6–15  | 44px     |
| XL      | 16+   | 52px     |

XL clusters display `"16+"` rather than the raw number.

---

## States

| State        | Trigger                                                         |
| ------------ | --------------------------------------------------------------- |
| Default      | No interaction                                                  |
| Hover        | Mouse over cluster                                              |
| Active       | Popover is open                                                 |
| Selected     | A defect within this cluster is open in the right panel         |
| Filtered-out | All defects in this cluster are excluded by the current filters |

Filtered-out clusters should not render. No ghost, no placeholder.

---

## Visual spec (MD3)

### Default

- `fill`: `#E8DEF8` (md-primary-container)
- `stroke`: `#6750A4` at 40% opacity, 1.5px
- `label`: `#21005D` (md-on-primary-container), 14px / weight 500

### Hover

- `fill`: `#E8DEF8` + `#6750A4` at 8% state layer
- `stroke`: `#6750A4` at 60% opacity, 1.5px
- `box-shadow`: `0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.1)`

### Active

- `fill`: `#E8DEF8` + `#6750A4` at 12% state layer
- `stroke`: `#6750A4` at 100% opacity, 2px
- `box-shadow`: `0 1px 2px rgba(0,0,0,.08), 0 2px 6px rgba(0,0,0,.12)`

### Selected

- `fill`: `#6750A4` (md-primary)
- `stroke`: `#6750A4`, 2px
- `label`: `#FFFFFF` (md-on-primary), weight 600
- `box-shadow`: `0 1px 2px rgba(0,0,0,.08), 0 2px 6px rgba(0,0,0,.12)`

> State layer is applied via a pseudo-element (`::after`) with `border-radius: 50%` and `pointer-events: none`.

---

## Interactions

### Hover

- Cluster grows slightly (`scale 1.08`, CSS transition ~120ms)
- Tooltip appears showing defect count only: `"4 defects"`
- No component name — at any zoom level the cluster may span multiple fittings

### Click — count > 1

- Popover opens anchored below the cluster
- Popover lists all defects in the cluster
- Each row: defect ID (monospace), short label, severity text tag (`High` / `Med` / `Low`)
- Selecting a row opens the right detail panel and sets this cluster to Selected state
- Clicking outside or pressing Escape closes the popover, returns to Default state

### Click — count = 1

- Skip popover entirely
- Directly opens right detail panel
- Cluster moves to Selected state

### Click — when zoomed too far out

- Animate zoom to fit the cluster's bounding box (~300ms ease)
- After zoom settles: if count > 1 show popover; if count = 1 open right panel directly

---

## Props

```ts
interface ClusterMarkerProps {
  count: number;
  defects: Defect[];
  state: "default" | "hover" | "active" | "selected";
  position: { x: number; y: number }; // canvas coordinates
  onSelect: (defectId: string) => void;
  onDismiss: () => void;
}
```

State is controlled externally — the parent manages which cluster is active/selected.

---

## Popover spec

- **Width**: 220px
- **Border-radius**: 12px
- **Surface**: `md-surface` with `md-outline-variant` border at 0.5px
- **Header**: defect count label, 11px uppercase, `md-on-surface-variant`
- **Rows**: defect ID in monospace (`Google Sans Mono`), label, severity tag
- **Selected row background**: `#EDE7F6`
- **Max visible rows before scroll**: 5

---

## Sync behaviour

- When a defect is selected via the popover, the left panel list scrolls to and highlights that defect.
- When a defect is selected in the left panel list, the corresponding cluster moves to Selected state and the diagram pans to bring it into view.
- Changing left panel filters does not affect Selected state unless the selected defect is filtered out — in that case the defect remains visible in the list dimmed with an "outside filter" indicator, and the right panel stays open.
