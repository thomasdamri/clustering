import L from 'leaflet';
import Supercluster from 'supercluster';
import type { Hitbox, Defect, LayerCallbacks, ClusterLayerHandle } from '../types';
import { ClusterAnimator } from './ClusterAnimator';
import type { MarkerSnapshot } from './ClusterAnimator';
import { convexHull } from '../utils/convexHull';
import type { Point2D } from '../utils/convexHull';

// ── Types ────────────────────────────────────────────────────────────────────

interface PointProps {
  defects: Defect[];
  position: string;
  lat: number;
  lng: number;
}

interface ClusterProps {
  defectCount: number;
}

type ClusterFeature =
  | Supercluster.ClusterFeature<ClusterProps>
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

function isCluster(f: ClusterFeature): f is Supercluster.ClusterFeature<ClusterProps> {
  return 'cluster_id' in f.properties;
}

function countForFeature(feature: ClusterFeature): number {
  if (isCluster(feature)) return feature.properties.defectCount;
  return feature.properties.defects.length;
}

function radiusForCount(count: number): number {
  if (count >= 50) return 33;
  if (count >= 25) return 28;
  if (count >= 10) return 24;
  if (count >= 5)  return 20;
  if (count >= 2)  return 17;
  return 14;
}

function labelForCount(count: number): string {
  return String(count);
}

function featureId(feature: ClusterFeature): string {
  if (isCluster(feature)) return `c:${feature.properties.cluster_id}`;
  return `p:${feature.properties.position}`;
}


// ── CanvasClusterLayer ────────────────────────────────────────────────────────

export class CanvasClusterLayer extends L.Layer implements ClusterLayerHandle {
  private _lmap: L.Map | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _sc: Supercluster<PointProps, ClusterProps>;
  private _rendered: RenderedItem[] = [];

  private _animFrame: number | null = null; // scheduled single-frame redraw (pan/hover)
  private _rafLoop:   number | null = null; // animation loop (zoom transition)
  private _zoomAnimFired = false;

  private _animator = new ClusterAnimator<ClusterFeature>();

  private _hovered:      RenderedItem | null = null;
  private _hoveredLeaves: Array<{ lat: number; lng: number }> | null = null;
  private _active:   RenderedItem | null = null;
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

    this._sc = new Supercluster<PointProps, ClusterProps>({
      radius: 60,
      maxZoom: 3,
      map:    (props) => ({ defectCount: props.defects.length }),
      reduce: (acc, props) => { acc.defectCount += props.defectCount; },
    });

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
    this._buildLayout();
    this._redraw();

    map.on('move',    this._scheduleRedraw,   this);
    map.on('moveend', this._handleViewChange, this);
    map.on('zoomanim', this._handleZoomAnim,  this);
    map.on('zoomend', this._handleZoomEnd,    this);
    map.on('resize',  this._handleViewChange, this);

    canvas.addEventListener('mousemove',  this._onMouseMove);
    canvas.addEventListener('click',      this._onClick);
    canvas.addEventListener('mouseleave', this._onMouseLeave);
    document.addEventListener('keydown',  this._onKeyDown);

    return this;
  }

  onRemove(_lmap: L.Map): this {
    if (this._animFrame !== null) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    this._stopRafLoop();

    _lmap.off('move',    this._scheduleRedraw,   this);
    _lmap.off('moveend', this._handleViewChange, this);
    _lmap.off('zoomanim', this._handleZoomAnim,  this);
    _lmap.off('zoomend', this._handleZoomEnd,    this);
    _lmap.off('resize',  this._handleViewChange, this);

    if (this._canvas) {
      this._canvas.removeEventListener('mousemove',  this._onMouseMove);
      this._canvas.removeEventListener('click',      this._onClick);
      this._canvas.removeEventListener('mouseleave', this._onMouseLeave);
      this._canvas.remove();
      this._canvas = null;
    }

    document.removeEventListener('keydown', this._onKeyDown);

    this._lmap = null;
    this._ctx  = null;
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
    this._active   = null;
    this._scheduleRedraw();
  }

  // ── Canvas sizing ──────────────────────────────────────────────────────────

  private _resize(): void {
    if (!this._lmap || !this._canvas) return;
    const size = this._lmap.getSize();
    const dpr  = window.devicePixelRatio || 1;
    this._canvas.width  = size.x * dpr;
    this._canvas.height = size.y * dpr;
    this._canvas.style.width  = size.x + 'px';
    this._canvas.style.height = size.y + 'px';
    const ctx = this._canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      this._ctx = ctx;
    }
  }

  // ── Layout computation ─────────────────────────────────────────────────────

  private _buildLayout(): MarkerSnapshot<ClusterFeature>[] {
    if (!this._lmap) return [];

    const map    = this._lmap;
    const bounds = map.getBounds();
    const sw     = bounds.getSouthWest();
    const ne     = bounds.getNorthEast();
    const bbox: [number, number, number, number] = [
      this._toScLng(sw.lng),
      this._toScLat(sw.lat),
      this._toScLng(ne.lng),
      this._toScLat(ne.lat),
    ];

    const zoom     = Math.round(map.getZoom());
    const features = this._sc.getClusters(bbox, zoom) as ClusterFeature[];

    const snapshots: MarkerSnapshot<ClusterFeature>[] = [];
    this._rendered = [];

    for (const feature of features) {
      const latlng = this._featureLatLng(feature);
      const pt     = map.latLngToContainerPoint(latlng);
      const count  = countForFeature(feature);
      const radius = radiusForCount(count);
      const id     = featureId(feature);

      this._rendered.push({ x: pt.x, y: pt.y, radius, feature, count });
      snapshots.push({ id, x: pt.x, y: pt.y, radius, count, feature });
    }

    return snapshots;
  }

  private _renderedToSnapshots(): MarkerSnapshot<ClusterFeature>[] {
    return this._rendered.map(item => ({
      id:      featureId(item.feature),
      x:       item.x,
      y:       item.y,
      radius:  item.radius,
      count:   item.count,
      feature: item.feature,
    }));
  }

  /** Compute cluster positions at a future zoom/center without updating this._rendered. */
  private _buildLayoutAt(zoom: number, center: L.LatLng): MarkerSnapshot<ClusterFeature>[] {
    if (!this._lmap) return [];
    const map   = this._lmap;
    const size  = map.getSize();
    const halfW = size.x / 2;
    const halfH = size.y / 2;

    const centerPx = map.project(center, zoom);
    const sw = map.unproject(L.point(centerPx.x - halfW, centerPx.y + halfH), zoom);
    const ne = map.unproject(L.point(centerPx.x + halfW, centerPx.y - halfH), zoom);
    const bbox: [number, number, number, number] = [
      this._toScLng(sw.lng), this._toScLat(sw.lat),
      this._toScLng(ne.lng), this._toScLat(ne.lat),
    ];

    const features = this._sc.getClusters(bbox, Math.round(zoom)) as ClusterFeature[];
    const snapshots: MarkerSnapshot<ClusterFeature>[] = [];

    for (const feature of features) {
      const latlng    = this._featureLatLng(feature);
      const featurePx = map.project(latlng, zoom);
      const x      = featurePx.x - centerPx.x + halfW;
      const y      = featurePx.y - centerPx.y + halfH;
      const count  = countForFeature(feature);
      const radius = radiusForCount(count);
      snapshots.push({ id: featureId(feature), x, y, radius, count, feature });
    }

    return snapshots;
  }

  /**
   * Build fromOverrides and toOverrides using supercluster's actual leaf membership
   * rather than screen-distance nearest-neighbour.
   */
  private _computeOverrides(
    oldSnaps: MarkerSnapshot<ClusterFeature>[],
    newSnaps: MarkerSnapshot<ClusterFeature>[],
  ): { fromOverrides: Map<string, { x: number; y: number; radius: number }>;
       toOverrides:   Map<string, { x: number; y: number }> } {
    const oldById = new Map(oldSnaps.map(s => [s.id, s]));
    const newById = new Map(newSnaps.map(s => [s.id, s]));
    const fromOverrides = new Map<string, { x: number; y: number; radius: number }>();
    const toOverrides   = new Map<string, { x: number; y: number }>();

    // Build leaf-position → old snapshot (for zoom-in: which old cluster owned each leaf)
    const leafToOld = new Map<string, MarkerSnapshot<ClusterFeature>>();
    for (const s of oldSnaps) {
      if (isCluster(s.feature)) {
        try {
          const leaves = this._sc.getLeaves(
            s.feature.properties.cluster_id, Infinity,
          ) as Supercluster.PointFeature<PointProps>[];
          for (const leaf of leaves) leafToOld.set(`p:${leaf.properties.position}`, s);
        } catch { /* cluster may not exist at this zoom */ }
      } else {
        leafToOld.set(featureId(s.feature), s);
      }
    }

    for (const s of newSnaps) {
      if (oldById.has(s.id)) continue;
      let parent: MarkerSnapshot<ClusterFeature> | undefined;
      if (isCluster(s.feature)) {
        try {
          const leaves = this._sc.getLeaves(
            s.feature.properties.cluster_id, Infinity,
          ) as Supercluster.PointFeature<PointProps>[];
          for (const leaf of leaves) {
            const p = leafToOld.get(`p:${leaf.properties.position}`);
            if (p) { parent = p; break; }
          }
        } catch { /* ignore */ }
      } else {
        parent = leafToOld.get(featureId(s.feature));
      }
      if (parent && parent.id !== s.id)
        fromOverrides.set(s.id, { x: parent.x, y: parent.y, radius: parent.radius });
    }

    // Build leaf-position → new snapshot (for zoom-out: which new cluster absorbs each leaf)
    const leafToNew = new Map<string, MarkerSnapshot<ClusterFeature>>();
    for (const s of newSnaps) {
      if (isCluster(s.feature)) {
        try {
          const leaves = this._sc.getLeaves(
            s.feature.properties.cluster_id, Infinity,
          ) as Supercluster.PointFeature<PointProps>[];
          for (const leaf of leaves) leafToNew.set(`p:${leaf.properties.position}`, s);
        } catch { /* ignore */ }
      } else {
        leafToNew.set(featureId(s.feature), s);
      }
    }

    for (const s of oldSnaps) {
      if (newById.has(s.id)) continue;
      if (this._lmap) {
        const pt   = this._lmap.latLngToContainerPoint(this._featureLatLng(s.feature));
        const size = this._lmap.getSize();
        if (pt.x < 0 || pt.x > size.x || pt.y < 0 || pt.y > size.y) continue;
      }
      let dest: MarkerSnapshot<ClusterFeature> | undefined;
      if (isCluster(s.feature)) {
        try {
          const leaves = this._sc.getLeaves(
            s.feature.properties.cluster_id, Infinity,
          ) as Supercluster.PointFeature<PointProps>[];
          for (const leaf of leaves) {
            const d = leafToNew.get(`p:${leaf.properties.position}`);
            if (d) { dest = d; break; }
          }
        } catch { /* ignore */ }
      } else {
        dest = leafToNew.get(featureId(s.feature));
      }
      if (dest && dest.id !== s.id)
        toOverrides.set(s.id, { x: dest.x, y: dest.y });
    }

    return { fromOverrides, toOverrides };
  }

  /**
   * For departing clusters that have no leaf-based toOverride, project their
   * geographic position to the target zoom/center and inject it as a toOverride.
   * This makes them animate to their correct off-screen position (and get clipped
   * by the canvas edge) rather than fading in place.
   */
  private _fillMissingToOverrides(
    oldSnaps:    MarkerSnapshot<ClusterFeature>[],
    newSnaps:    MarkerSnapshot<ClusterFeature>[],
    toOverrides: Map<string, { x: number; y: number }>,
    targetZoom:  number,
    targetCenter: L.LatLng,
  ): void {
    if (!this._lmap) return;
    const map      = this._lmap;
    const size     = map.getSize();
    const halfW    = size.x / 2;
    const halfH    = size.y / 2;
    const centerPx = map.project(targetCenter, targetZoom);
    const newIds   = new Set(newSnaps.map(s => s.id));

    for (const s of oldSnaps) {
      if (newIds.has(s.id))       continue; // continuing marker — handled separately
      if (toOverrides.has(s.id))  continue; // already has a leaf-based destination
      const latlng    = this._featureLatLng(s.feature);
      const featurePx = map.project(latlng, targetZoom);
      toOverrides.set(s.id, {
        x: featurePx.x - centerPx.x + halfW,
        y: featurePx.y - centerPx.y + halfH,
      });
    }
  }

  /**
   * For appearing clusters that have no leaf-based fromOverride, project their
   * geographic position back to the old zoom/center and inject it as a fromOverride.
   * This makes them slide in from off-screen rather than snapping to their final position.
   */
  private _fillMissingFromOverrides(
    oldSnaps:      MarkerSnapshot<ClusterFeature>[],
    newSnaps:      MarkerSnapshot<ClusterFeature>[],
    fromOverrides: Map<string, { x: number; y: number; radius: number }>,
    oldZoom:       number,
    oldCenter:     L.LatLng,
  ): void {
    if (!this._lmap) return;
    const map      = this._lmap;
    const size     = map.getSize();
    const halfW    = size.x / 2;
    const halfH    = size.y / 2;
    const centerPx = map.project(oldCenter, oldZoom);
    const oldIds   = new Set(oldSnaps.map(s => s.id));

    for (const s of newSnaps) {
      if (oldIds.has(s.id))        continue; // continuing marker
      if (fromOverrides.has(s.id)) continue; // already has a leaf-based origin
      const latlng    = this._featureLatLng(s.feature);
      const featurePx = map.project(latlng, oldZoom);
      fromOverrides.set(s.id, {
        x:      featurePx.x - centerPx.x + halfW,
        y:      featurePx.y - centerPx.y + halfH,
        radius: s.radius,
      });
    }
  }

  // ── Redraw scheduling ──────────────────────────────────────────────────────

  private _scheduleRedraw = (): void => {
    if (this._animFrame !== null || this._rafLoop !== null) return;
    this._animFrame = requestAnimationFrame(() => {
      this._animFrame = null;
      this._redraw();
    });
  };

  private _handleViewChange = (): void => {
    this._resize();
    this._buildLayout();
    this._redraw();
  };

  private _handleZoomAnim = (e: L.ZoomAnimEvent): void => {
    this._zoomAnimFired = true;
    this._stopRafLoop();

    const oldSnapshots = this._renderedToSnapshots();
    this._animator.snapshot(oldSnapshots);

    const oldZoom   = this._lmap!.getZoom();
    const oldCenter = this._lmap!.getCenter();

    // Positions at the TARGET zoom/center — map hasn't moved yet
    const newSnapshots = this._buildLayoutAt(e.zoom, e.center);
    const overrides    = this._computeOverrides(oldSnapshots, newSnapshots);
    this._fillMissingToOverrides(oldSnapshots, newSnapshots, overrides.toOverrides, e.zoom, e.center);
    this._fillMissingFromOverrides(oldSnapshots, newSnapshots, overrides.fromOverrides, oldZoom, oldCenter);
    this._animator.transition(newSnapshots, overrides);
    this._startRafLoop();
  };

  private _handleZoomEnd = (): void => {
    this._resize();

    if (this._zoomAnimFired) {
      // Animation started in zoomanim — just sync rendered list for hit-testing
      this._zoomAnimFired = false;
      this._buildLayout();
      return;
    }

    // Fallback: non-animated zoom (programmatic flyTo, large jump, etc.)
    const oldSnapshots = this._renderedToSnapshots();
    this._animator.snapshot(oldSnapshots);
    const newSnapshots = this._buildLayout();
    const overrides    = this._computeOverrides(oldSnapshots, newSnapshots);
    this._fillMissingToOverrides(oldSnapshots, newSnapshots, overrides.toOverrides, this._lmap!.getZoom(), this._lmap!.getCenter());
    this._animator.transition(newSnapshots, overrides);
    this._stopRafLoop();
    this._startRafLoop();
  };

  // ── Animation RAF loop ─────────────────────────────────────────────────────

  private _startRafLoop(): void {
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      this._animator.advance(delta);
      this._redraw();
      if (this._animator.isAnimating) {
        this._rafLoop = requestAnimationFrame(tick);
      } else {
        this._rafLoop = null;
      }
    };
    this._rafLoop = requestAnimationFrame(tick);
  }

  private _stopRafLoop(): void {
    if (this._rafLoop !== null) {
      cancelAnimationFrame(this._rafLoop);
      this._rafLoop = null;
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _redraw(): void {
    if (!this._lmap || !this._ctx || !this._canvas) return;

    const map  = this._lmap;
    const ctx  = this._ctx;
    const size = map.getSize();

    ctx.clearRect(0, 0, size.x, size.y);

    // Draw convex hull for hovered cluster beneath all markers
    if (!this._animator.isAnimating && this._hoveredLeaves !== null) {
      const pts: Point2D[] = this._hoveredLeaves.map(ll =>
        map.latLngToContainerPoint(L.latLng(ll.lat, ll.lng)),
      );
      this._drawHull(ctx, pts);
    }

    if (this._animator.isAnimating) {
      for (const m of this._animator.getFrame()) {
        const state = this._stateFor(m.feature);
        this._drawCircle(ctx, m.x, m.y, m.radius, m.count, state, m.opacity);
      }
      return;
    }

    // Non-animating: reproject to handle pan
    this._rendered = [];
    const bounds = map.getBounds();
    const sw     = bounds.getSouthWest();
    const ne     = bounds.getNorthEast();
    const bbox: [number, number, number, number] = [
      this._toScLng(sw.lng),
      this._toScLat(sw.lat),
      this._toScLng(ne.lng),
      this._toScLat(ne.lat),
    ];

    const zoom     = Math.round(map.getZoom());
    const features = this._sc.getClusters(bbox, zoom) as ClusterFeature[];

    for (const feature of features) {
      const latlng = this._featureLatLng(feature);
      const pt     = map.latLngToContainerPoint(latlng);
      const count  = countForFeature(feature);
      const radius = radiusForCount(count);

      const state = this._stateFor(feature);
      this._drawCircle(ctx, pt.x, pt.y, radius, count, state);
      this._rendered.push({ x: pt.x, y: pt.y, radius, feature, count });
    }
  }

  private _stateFor(feature: ClusterFeature): MarkerState {
    if (this._selected && this._selected.feature === feature) return 'selected';
    if (this._active   && this._active.feature   === feature) return 'active';
    if (this._hovered  && this._hovered.feature  === feature) return 'hover';
    return 'default';
  }

  private _drawHull(ctx: CanvasRenderingContext2D, pts: Point2D[]): void {
    if (pts.length === 0) return;

    ctx.save();

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(103, 80, 164, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(103, 80, 164, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.strokeStyle = 'rgba(103, 80, 164, 0.6)';
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.25;
      ctx.stroke();
    } else {
      const hull = convexHull(pts);
      ctx.beginPath();
      ctx.moveTo(hull[0].x, hull[0].y);
      for (let i = 1; i < hull.length; i++) {
        ctx.lineTo(hull[i].x, hull[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(103, 80, 164, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(103, 80, 164, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    ctx.restore();
  }

  private _drawCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    baseRadius: number,
    count: number,
    state: MarkerState,
    opacity = 1,
  ): void {
    const r = state === 'hover' ? baseRadius * 1.08 : baseRadius;

    let fillColor: string;
    let strokeColor: string;
    let strokeWidth: number;
    let overlayColor: string | null = null;
    let textColor: string;

    switch (state) {
      case 'selected':
        fillColor   = '#6750A4';
        strokeColor = '#6750A4';
        strokeWidth = 2;
        textColor   = '#FFFFFF';
        break;
      case 'active':
        fillColor    = '#E8DEF8';
        strokeColor  = '#6750A4';
        strokeWidth  = 2;
        overlayColor = 'rgba(103, 80, 164, 0.12)';
        textColor    = '#21005D';
        break;
      case 'hover':
        fillColor    = '#E8DEF8';
        strokeColor  = 'rgba(103, 80, 164, 0.6)';
        strokeWidth  = 1.5;
        overlayColor = 'rgba(103, 80, 164, 0.08)';
        textColor    = '#21005D';
        break;
      default:
        fillColor   = '#E8DEF8';
        strokeColor = 'rgba(103, 80, 164, 0.4)';
        strokeWidth = 1.5;
        textColor   = '#21005D';
        break;
    }

    ctx.save();
    ctx.globalAlpha = opacity;

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
    ctx.lineWidth   = strokeWidth;
    ctx.stroke();

    ctx.font         = '500 14px system-ui, sans-serif';
    ctx.fillStyle    = textColor;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelForCount(count), x, y);

    ctx.restore();
  }

  // ── Hit testing ────────────────────────────────────────────────────────────

  private _hitTest(clientX: number, clientY: number): RenderedItem | null {
    if (!this._canvas) return null;
    const rect = this._canvas.getBoundingClientRect();
    const x    = clientX - rect.left;
    const y    = clientY - rect.top;
    for (let i = this._rendered.length - 1; i >= 0; i--) {
      const item = this._rendered[i];
      if ((x - item.x) ** 2 + (y - item.y) ** 2 <= item.radius ** 2) return item;
    }
    return null;
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private _onMouseMove = (e: MouseEvent): void => {
    const hit     = this._hitTest(e.clientX, e.clientY);
    const changed = hit !== this._hovered;
    this._hovered = hit;

    if (changed) {
      if (hit !== null && isCluster(hit.feature)) {
        const leaves = this._sc.getLeaves(
          (hit.feature as Supercluster.ClusterFeature<ClusterProps>).properties.cluster_id,
          Infinity,
        ) as Supercluster.PointFeature<PointProps>[];
        this._hoveredLeaves = leaves.map(l => ({ lat: l.properties.lat, lng: l.properties.lng }));
      } else {
        this._hoveredLeaves = null;
      }
    }

    if (this._canvas) this._canvas.style.cursor = hit ? 'pointer' : '';

    if (changed) {
      if (hit) {
        this._callbacks?.onHover({ x: e.clientX, y: e.clientY, count: hit.count });
      } else {
        this._callbacks?.onHoverEnd();
      }
      this._scheduleRedraw();
    }
  };

  private _onMouseLeave = (): void => {
    if (!this._hovered) return;
    this._hovered = null;
    this._hoveredLeaves = null;
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

    const map              = this._lmap;
    const feature          = hit.feature;
    const featureIsCluster = isCluster(feature);

    const zoom                = map.getZoom();
    const disableClusteringAtZoom = 4;
    if (featureIsCluster && zoom < disableClusteringAtZoom - 1) {
      const expansionZoom = this._sc.getClusterExpansionZoom(
        feature.properties.cluster_id,
      );
      const latlng = this._featureLatLng(feature);
      map.flyTo(latlng, expansionZoom, { duration: 0.3 });
      this._scheduleRedraw();
      return;
    }

    let allDefects: Defect[];
    if (featureIsCluster) {
      const leaves = this._sc.getLeaves(
        feature.properties.cluster_id,
        Infinity,
      ) as Supercluster.PointFeature<PointProps>[];
      allDefects = leaves.flatMap(l => l.properties.defects);
    } else {
      allDefects = feature.properties.defects;
    }

    if (allDefects.length <= 1) {
      this._active   = null;
      this._selected = hit;
      this._scheduleRedraw();
      return;
    }

    this._selected = null;
    this._active   = hit;
    this._scheduleRedraw();
    this._callbacks?.onClusterClick({ x: e.clientX, y: e.clientY, defects: allDefects });
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    const hadActiveOrSelected = !!(this._active || this._selected);
    this._active   = null;
    this._selected = null;
    this._scheduleRedraw();
    if (hadActiveOrSelected) this._callbacks?.onDismiss();
  };
}
