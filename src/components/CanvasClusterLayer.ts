import L from 'leaflet';
import Supercluster from 'supercluster';
import type { Hitbox, Defect, LayerCallbacks, ClusterLayerHandle } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

interface PointProps {
  defects: Defect[];
  position: string;
  lat: number;
  lng: number;
}

type ClusterFeature =
  | Supercluster.ClusterFeature<PointProps>
  | Supercluster.PointFeature<PointProps>;

interface RenderedItem {
  x: number;
  y: number;
  radius: number;
  feature: ClusterFeature;
  count: number;
}

type MarkerState = 'default' | 'hover' | 'active' | 'selected';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

export class CanvasClusterLayer extends L.Layer implements ClusterLayerHandle {
  private _lmap: L.Map | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _sc: Supercluster<PointProps>;
  private _rendered: RenderedItem[] = [];
  private _animFrame: number | null = null;

  private _hovered: RenderedItem | null = null;
  private _active: RenderedItem | null = null;
  private _selected: RenderedItem | null = null;
  private _callbacks?: LayerCallbacks;

  private _latMin: number;
  private _latMax: number;
  private _lngMax: number;

  constructor(
    hitboxes: Hitbox[],
    defectsByPos: Map<string, Defect[]>,
    bounds: [[number, number], [number, number]],
    callbacks?: LayerCallbacks,
  ) {
    super();
    this._callbacks = callbacks;

    this._latMin = bounds[0][0];
    this._latMax = bounds[1][0];
    this._lngMax = bounds[1][1];

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

    this._lmap = null;
    this._ctx = null;
    return this;
  }

  // ── Public handle methods ──────────────────────────────────────────────────

  clearActive(): void {
    this._active = null;
    this._scheduleRedraw();
  }

  clearSelected(): void {
    this._selected = null;
    this._scheduleRedraw();
  }

  selectActive(): void {
    if (!this._active) return;
    this._selected = this._active;
    this._active = null;
    this._scheduleRedraw();
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

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();

    if (overlayColor) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = overlayColor;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

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

  // ── Event handlers ─────────────────────────────────────────────────────────

  private _onMouseMove = (e: MouseEvent): void => {
    const hit = this._hitTest(e.clientX, e.clientY);
    const changed = hit !== this._hovered;
    this._hovered = hit;

    if (this._canvas) this._canvas.style.cursor = hit ? 'pointer' : '';

    if (hit) {
      // Always update position so tooltip follows cursor within cluster
      this._callbacks?.onHover({ x: e.clientX, y: e.clientY, count: hit.count });
    } else if (changed) {
      this._callbacks?.onHoverEnd();
    }

    if (changed) this._scheduleRedraw();
  };

  private _onMouseLeave = (): void => {
    if (!this._hovered) return;
    this._hovered = null;
    if (this._canvas) this._canvas.style.cursor = '';
    this._callbacks?.onHoverEnd();
    this._scheduleRedraw();
  };

  private _onClick = (e: MouseEvent): void => {
    if (!this._lmap) return;
    const hit = this._hitTest(e.clientX, e.clientY);
    if (!hit) return;

    this._hovered = null;
    this._callbacks?.onHoverEnd();

    const map = this._lmap;
    const feature = hit.feature;
    const featureIsCluster = isCluster(feature);

    const zoom = map.getZoom();
    const disableClusteringAtZoom = 4;
    if (featureIsCluster && zoom < disableClusteringAtZoom - 1) {
      const expansionZoom = this._sc.getClusterExpansionZoom(
        feature.properties.cluster_id,
      );
      const latlng = this._featureLatLng(feature);
      map.flyTo(latlng, expansionZoom, { duration: 0.3 });
      return;
    }

    let allDefects: Defect[];
    if (featureIsCluster) {
      const leaves = this._sc.getLeaves(
        feature.properties.cluster_id,
        Infinity,
      ) as Supercluster.PointFeature<PointProps>[];
      allDefects = leaves.flatMap((l) => l.properties.defects);
    } else {
      allDefects = feature.properties.defects;
    }

    if (allDefects.length <= 1) {
      this._active = null;
      this._selected = hit;
      this._scheduleRedraw();
      return;
    }

    this._selected = null;
    this._active = hit;
    this._scheduleRedraw();
    this._callbacks?.onClusterClick({ x: e.clientX, y: e.clientY, defects: allDefects });
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    const hadActiveOrSelected = !!(this._active || this._selected);
    this._active = null;
    this._selected = null;
    this._scheduleRedraw();
    if (hadActiveOrSelected) this._callbacks?.onDismiss();
  };
}
