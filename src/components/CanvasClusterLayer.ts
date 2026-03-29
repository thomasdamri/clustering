import L from 'leaflet';
import Supercluster from 'supercluster';
import type { Hitbox, Defect } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

interface PointProps {
  defects: Defect[];
  position: string;
  // Original Leaflet coordinates stored so no back-conversion needed for points
  lat: number;
  lng: number;
}

type ClusterFeature = Supercluster.ClusterFeature<PointProps> | Supercluster.PointFeature<PointProps>;

interface RenderedItem {
  x: number;
  y: number;
  radius: number;
  feature: ClusterFeature;
  count: number;
}

type MarkerState = 'default' | 'hover' | 'active' | 'selected';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPopoverHTML(defects: Defect[]): string {
  const rows = defects
    .map(
      (d) =>
        `<div class="defect-popover-row" data-defect-id="${d.defectId}">
          <span class="defect-popover-id">${d.defectId}</span>
          <span class="defect-popover-desc">${d.description}</span>
        </div>`,
    )
    .join('');
  return `<div class="defect-popover">
    <div class="defect-popover-header">${defects.length} DEFECT${defects.length > 1 ? 'S' : ''}</div>
    <div class="defect-popover-body">${rows}</div>
  </div>`;
}

function attachRowClickHandlers(popup: L.Popup, onRowClick: () => void) {
  requestAnimationFrame(() => {
    const container = popup.getElement();
    if (!container) return;
    container.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('.defect-popover-row') as HTMLElement | null;
      if (!row) return;
      container
        .querySelectorAll('.defect-popover-row-selected')
        .forEach((el) => el.classList.remove('defect-popover-row-selected'));
      row.classList.add('defect-popover-row-selected');
      onRowClick();
    });
  });
}

function isCluster(f: ClusterFeature): f is Supercluster.ClusterFeature<PointProps> {
  return 'cluster_id' in f.properties;
}

function countForFeature(feature: ClusterFeature): number {
  if (isCluster(feature)) return feature.properties.point_count;
  return feature.properties.defects.length;
}

function radiusForCount(count: number): number {
  if (count >= 16) return 26;
  if (count >= 6) return 22;
  if (count >= 2) return 18;
  return 14;
}

function labelForCount(count: number): string {
  return count >= 16 ? '16+' : String(count);
}

// ── CanvasClusterLayer ────────────────────────────────────────────────────────

export class CanvasClusterLayer extends L.Layer {
  private _lmap: L.Map | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _sc: Supercluster<PointProps>;
  private _rendered: RenderedItem[] = [];
  private _animFrame: number | null = null;

  private _hovered: RenderedItem | null = null;
  private _active: RenderedItem | null = null;
  private _selected: RenderedItem | null = null;
  private _activePopup: L.Popup | null = null;
  private _tooltip: L.Tooltip = L.tooltip({ direction: 'top', className: 'defect-tooltip' });

  // Leaflet bounds for coordinate conversion
  private _latMin: number;
  private _latMax: number;
  private _lngMax: number;

  constructor(
    hitboxes: Hitbox[],
    defectsByPos: Map<string, Defect[]>,
    bounds: [[number, number], [number, number]],
  ) {
    super();

    this._latMin = bounds[0][0]; // -256
    this._latMax = bounds[1][0]; // 0
    this._lngMax = bounds[1][1]; // 1819.0431

    // Build spatial index. maxZoom:3 matches map max_zoom so at zoom 3
    // all points are individual (equivalent to disableClusteringAtZoom:4).
    this._sc = new Supercluster<PointProps>({ radius: 60, maxZoom: 3 });

    const hitboxMap = new Map<string, Hitbox>();
    for (const h of hitboxes) hitboxMap.set(h.label, h);

    const points: Supercluster.PointFeature<PointProps>[] = [];
    for (const [pos, defects] of defectsByPos) {
      const hb = hitboxMap.get(pos);
      if (!hb) continue;
      const { lat, lng } = hb.leaflet;
      points.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [this._toScLng(lng), this._toScLat(lat)],
        },
        properties: { defects, position: pos, lat, lng },
      });
    }

    this._sc.load(points);
  }

  // ── Coordinate conversion ──────────────────────────────────────────────────

  private _toScLng(leafletLng: number): number {
    return (leafletLng / this._lngMax) * 360 - 180;
  }

  private _toScLat(leafletLat: number): number {
    return ((leafletLat - this._latMin) / (this._latMax - this._latMin)) * 170 - 85;
  }

  private _scToLatLng(scLng: number, scLat: number): L.LatLng {
    const lng = ((scLng + 180) / 360) * this._lngMax;
    const lat = ((scLat + 85) / 170) * (this._latMax - this._latMin) + this._latMin;
    return L.latLng(lat, lng);
  }

  private _featureLatLng(feature: ClusterFeature): L.LatLng {
    const [scLng, scLat] = feature.geometry.coordinates;
    return this._scToLatLng(scLng, scLat);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onAdd(map: L.Map): this {
    this._lmap = map;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:auto;z-index:400';
    map.getContainer().appendChild(canvas);
    this._canvas = canvas;

    this._resize();
    const ctx = canvas.getContext('2d');
    if (!ctx) return this;
    this._ctx = ctx;
    this._redraw();

    map.on('move', this._scheduleRedraw, this);
    map.on('moveend', this._handleViewChange, this);
    map.on('zoomend', this._handleViewChange, this);
    map.on('resize', this._handleViewChange, this);

    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('mouseleave', this._onMouseLeave);
    document.addEventListener('keydown', this._onKeyDown);

    return this;
  }

  onRemove(_lmap: L.Map): this {
    if (this._animFrame !== null) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }

    _lmap.off('move', this._scheduleRedraw, this);
    _lmap.off('moveend', this._handleViewChange, this);
    _lmap.off('zoomend', this._handleViewChange, this);
    _lmap.off('resize', this._handleViewChange, this);

    if (this._canvas) {
      this._canvas.removeEventListener('mousemove', this._onMouseMove);
      this._canvas.removeEventListener('click', this._onClick);
      this._canvas.removeEventListener('mouseleave', this._onMouseLeave);
      this._canvas.remove();
      this._canvas = null;
    }

    document.removeEventListener('keydown', this._onKeyDown);

    this._tooltip.remove();
    if (this._activePopup) {
      _lmap.closePopup(this._activePopup);
      this._activePopup = null;
    }

    this._lmap = null;
    this._ctx = null;
    return this;
  }

  // ── Canvas sizing ──────────────────────────────────────────────────────────

  private _resize(): void {
    if (!this._lmap || !this._canvas) return;
    const size = this._lmap.getSize();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = size.x * dpr;
    this._canvas.height = size.y * dpr;
    this._canvas.style.width = size.x + 'px';
    this._canvas.style.height = size.y + 'px';
    // Re-fetch context and scale after resize
    const ctx = this._canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      this._ctx = ctx;
    }
  }

  // ── Redraw scheduling ──────────────────────────────────────────────────────

  private _scheduleRedraw = (): void => {
    if (this._animFrame !== null) return;
    this._animFrame = requestAnimationFrame(() => {
      this._animFrame = null;
      this._redraw();
    });
  };

  private _handleViewChange = (): void => {
    this._resize();
    this._redraw();
  };

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _redraw(): void {
    if (!this._lmap || !this._ctx || !this._canvas) return;

    const map = this._lmap;
    const ctx = this._ctx;
    const size = map.getSize();

    ctx.clearRect(0, 0, size.x, size.y);
    this._rendered = [];

    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const bbox: [number, number, number, number] = [
      this._toScLng(sw.lng),
      this._toScLat(sw.lat),
      this._toScLng(ne.lng),
      this._toScLat(ne.lat),
    ];

    const zoom = Math.round(map.getZoom());
    const features = this._sc.getClusters(bbox, zoom) as ClusterFeature[];

    for (const feature of features) {
      const latlng = this._featureLatLng(feature);
      const pt = map.latLngToContainerPoint(latlng);
      const count = countForFeature(feature);
      const radius = radiusForCount(count);

      const state = this._stateFor(feature);
      this._drawCircle(ctx, pt.x, pt.y, radius, count, state);

      this._rendered.push({ x: pt.x, y: pt.y, radius, feature, count });
    }
  }

  private _stateFor(feature: ClusterFeature): MarkerState {
    if (this._selected && this._selected.feature === feature) return 'selected';
    if (this._active && this._active.feature === feature) return 'active';
    if (this._hovered && this._hovered.feature === feature) return 'hover';
    return 'default';
  }

  private _drawCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    baseRadius: number,
    count: number,
    state: MarkerState,
  ): void {
    const r = state === 'hover' ? baseRadius * 1.08 : baseRadius;

    let fillColor: string;
    let strokeColor: string;
    let strokeWidth: number;
    let overlayColor: string | null = null;
    let textColor: string;

    switch (state) {
      case 'selected':
        fillColor = '#6750A4';
        strokeColor = '#6750A4';
        strokeWidth = 2;
        textColor = '#FFFFFF';
        break;
      case 'active':
        fillColor = '#E8DEF8';
        strokeColor = '#6750A4';
        strokeWidth = 2;
        overlayColor = 'rgba(103, 80, 164, 0.12)';
        textColor = '#21005D';
        break;
      case 'hover':
        fillColor = '#E8DEF8';
        strokeColor = 'rgba(103, 80, 164, 0.6)';
        strokeWidth = 1.5;
        overlayColor = 'rgba(103, 80, 164, 0.08)';
        textColor = '#21005D';
        break;
      default:
        fillColor = '#E8DEF8';
        strokeColor = 'rgba(103, 80, 164, 0.4)';
        strokeWidth = 1.5;
        textColor = '#21005D';
        break;
    }

    // Fill
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Overlay (hover/active state layer)
    if (overlayColor) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = overlayColor;
      ctx.fill();
    }

    // Stroke
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

    // Label
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelForCount(count), x, y);
  }

  // ── Hit testing ────────────────────────────────────────────────────────────

  private _hitTest(clientX: number, clientY: number): RenderedItem | null {
    if (!this._canvas) return null;
    const rect = this._canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let i = this._rendered.length - 1; i >= 0; i--) {
      const item = this._rendered[i];
      if ((x - item.x) ** 2 + (y - item.y) ** 2 <= item.radius ** 2) return item;
    }
    return null;
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────

  private _showTooltip(item: RenderedItem): void {
    if (!this._lmap) return;
    const count = item.count;
    const latlng = this._featureLatLng(item.feature);
    this._tooltip
      .setLatLng(latlng)
      .setContent(`${count} defect${count !== 1 ? 's' : ''}`)
      .addTo(this._lmap);
  }

  private _hideTooltip(): void {
    this._tooltip.remove();
  }

  // ── State management ───────────────────────────────────────────────────────

  private _clearActive(): void {
    if (this._activePopup && this._lmap) {
      this._lmap.closePopup(this._activePopup);
      this._activePopup = null;
    }
    this._active = null;
  }

  private _clearSelected(): void {
    this._selected = null;
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private _onMouseMove = (e: MouseEvent): void => {
    const hit = this._hitTest(e.clientX, e.clientY);
    if (hit === this._hovered) return;
    this._hovered = hit;
    if (this._canvas) this._canvas.style.cursor = hit ? 'pointer' : '';
    this._hideTooltip();
    if (hit) this._showTooltip(hit);
    this._scheduleRedraw();
  };

  private _onMouseLeave = (): void => {
    if (!this._hovered) return;
    this._hovered = null;
    if (this._canvas) this._canvas.style.cursor = '';
    this._hideTooltip();
    this._scheduleRedraw();
  };

  private _onClick = (e: MouseEvent): void => {
    if (!this._lmap) return;
    const hit = this._hitTest(e.clientX, e.clientY);
    if (!hit) return;

    this._hideTooltip();

    const map = this._lmap;
    const feature = hit.feature;
    const featureIsCluster = isCluster(feature);

    // Zoom-to-fit for deeply clustered markers
    const zoom = map.getZoom();
    const disableClusteringAtZoom = 4;
    if (featureIsCluster && zoom < disableClusteringAtZoom - 1) {
      const expansionZoom = this._sc.getClusterExpansionZoom(feature.properties.cluster_id);
      const latlng = this._featureLatLng(feature);
      map.flyTo(latlng, expansionZoom, { duration: 0.3 });
      return;
    }

    // Gather defects
    let allDefects: Defect[];
    if (featureIsCluster) {
      const leaves = this._sc.getLeaves(feature.properties.cluster_id, Infinity) as Supercluster.PointFeature<PointProps>[];
      allDefects = leaves.flatMap((l) => l.properties.defects);
    } else {
      allDefects = feature.properties.defects;
    }

    // Single defect — just select
    if (allDefects.length <= 1) {
      this._clearActive();
      this._selected = hit;
      this._scheduleRedraw();
      return;
    }

    // Open popover
    this._clearSelected();
    const latlng = this._featureLatLng(feature);
    const popup = L.popup({
      className: 'defect-popover-popup',
      closeButton: false,
      autoClose: true,
      closeOnClick: true,
      maxWidth: 220,
      minWidth: 220,
    })
      .setLatLng(latlng)
      .setContent(buildPopoverHTML(allDefects));

    popup.on('remove', () => {
      if (this._active && this._active.feature === feature) {
        this._active = null;
        this._activePopup = null;
        this._scheduleRedraw();
      }
    });

    popup.openOn(map);
    this._clearActive();
    this._active = hit;
    this._activePopup = popup;
    this._scheduleRedraw();

    attachRowClickHandlers(popup, () => {
      this._clearActive();
      this._selected = hit;
      this._scheduleRedraw();
    });
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    this._clearActive();
    this._clearSelected();
    this._scheduleRedraw();
  };
}
