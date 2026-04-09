import L from 'leaflet';
import type { Hitbox, ClusterLayerHandle } from '../types';

interface ScreenQuad {
  label: string;
  pts: { x: number; y: number }[];  // 4 screen-space points (clockwise or CCW)
}

/** Returns true if screen point (px, py) is inside the convex polygon defined by pts. */
function pointInPolygon(px: number, py: number, pts: { x: number; y: number }[]): boolean {
  let winding = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const cross = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
    if (a.y <= py) {
      if (b.y > py && cross > 0) winding++;
    } else {
      if (b.y <= py && cross < 0) winding--;
    }
  }
  return winding !== 0;
}

export class InspectLayer implements ClusterLayerHandle {
  private readonly _hitboxes: Hitbox[];
  private _map: L.Map | null = null;
  private _canvas!: HTMLCanvasElement;
  private _ctx!: CanvasRenderingContext2D;
  private _rafId: number | null = null;
  private _rendered: ScreenQuad[] = [];
  private _hovered: string | null = null;
  private _active: string | null = null;

  // Zoom animation state — canvas sits outside Leaflet's CSS zoom transform,
  // so we must recompute positions every frame during animation using the target zoom.
  private _zoomAnimating = false;
  private _animZoom = 0;
  private _animCenter: L.LatLng | null = null;

  // Bound handlers (stored so we can remove them)
  private _boundMouseMove: (e: MouseEvent) => void;
  private _boundClick: (e: MouseEvent) => void;
  private _boundMouseLeave: () => void;
  private _boundKeyDown: (e: KeyboardEvent) => void;
  private _boundRedraw: () => void;
  private _boundResize: () => void;
  private _boundZoomAnim: (e: L.ZoomAnimEvent) => void;
  private _boundZoomEnd: () => void;

  constructor(hitboxes: Hitbox[]) {
    this._hitboxes = hitboxes;
    this._boundMouseMove = (e) => this._onMouseMove(e);
    this._boundClick = (e) => this._onClick(e);
    this._boundMouseLeave = () => this._onMouseLeave();
    this._boundKeyDown = (e) => this._onKeyDown(e);
    this._boundRedraw = () => this._scheduleRedraw();
    this._boundResize = () => { this._resizeCanvas(); this._scheduleRedraw(); };
    this._boundZoomAnim = (e) => this._onZoomAnim(e);
    this._boundZoomEnd = () => this._onZoomEnd();
  }

  addTo(map: L.Map): void {
    this._map = map;
    const container = map.getContainer();

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '400';
    canvas.style.pointerEvents = 'auto';
    container.appendChild(canvas);
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d')!;

    this._resizeCanvas();

    // Map events
    map.on('move', this._boundRedraw);
    map.on('moveend', this._boundRedraw);
    map.on('zoomanim', this._boundZoomAnim);
    map.on('zoomend', this._boundZoomEnd);
    map.on('resize', this._boundResize);

    // Mouse events
    canvas.addEventListener('mousemove', this._boundMouseMove);
    canvas.addEventListener('click', this._boundClick);
    canvas.addEventListener('mouseleave', this._boundMouseLeave);
    document.addEventListener('keydown', this._boundKeyDown);

    this._scheduleRedraw();
  }

  remove(): void {
    const map = this._map;
    if (!map) return;

    map.off('move', this._boundRedraw);
    map.off('moveend', this._boundRedraw);
    map.off('zoomanim', this._boundZoomAnim);
    map.off('zoomend', this._boundZoomEnd);
    map.off('resize', this._boundResize);

    this._canvas.removeEventListener('mousemove', this._boundMouseMove);
    this._canvas.removeEventListener('click', this._boundClick);
    this._canvas.removeEventListener('mouseleave', this._boundMouseLeave);
    document.removeEventListener('keydown', this._boundKeyDown);

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._canvas.remove();
    this._map = null;
  }

  clearActive(): void {
    this._active = null;
    this._scheduleRedraw();
  }

  clearSelected(): void { /* no-op */ }
  selectActive(): void { /* no-op */ }

  // ── Private ──────────────────────────────────────────────────────────

  private _resizeCanvas(): void {
    const map = this._map;
    if (!map) return;
    const container = map.getContainer();
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this._canvas.width = Math.round(w * dpr);
    this._canvas.height = Math.round(h * dpr);
    this._canvas.style.width = `${w}px`;
    this._canvas.style.height = `${h}px`;
    const ctx = this._ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  private _scheduleRedraw(): void {
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._redraw();
      // Keep looping every frame while zoom animation is in progress
      if (this._zoomAnimating) this._scheduleRedraw();
    });
  }

  /** Compute container-space point, accounting for in-progress zoom animation. */
  private _toContainerPt(map: L.Map, lat: number, lng: number): { x: number; y: number } {
    if (this._zoomAnimating && this._animCenter !== null) {
      // During animation, map.latLngToContainerPoint() still uses the old zoom.
      // Use map.project() at the target zoom instead, then offset from center.
      const mapSize = map.getSize();
      const centerPx = map.project(this._animCenter, this._animZoom);
      const pt = map.project(L.latLng(lat, lng), this._animZoom);
      return {
        x: pt.x - centerPx.x + mapSize.x / 2,
        y: pt.y - centerPx.y + mapSize.y / 2,
      };
    }
    const p = map.latLngToContainerPoint(L.latLng(lat, lng));
    return { x: p.x, y: p.y };
  }

  private _onZoomAnim(e: L.ZoomAnimEvent): void {
    this._zoomAnimating = true;
    this._animZoom = e.zoom;
    this._animCenter = e.center;
    this._scheduleRedraw();
  }

  private _onZoomEnd(): void {
    this._zoomAnimating = false;
    this._animCenter = null;
    this._scheduleRedraw();
  }

  private _redraw(): void {
    const map = this._map;
    if (!map) return;

    const ctx = this._ctx;
    const canvas = this._canvas;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    const quads: ScreenQuad[] = [];

    for (const hb of this._hitboxes) {
      if (!hb.found || !hb.bbox) continue;
      const corners = hb.bbox.leaflet.corners;
      if (corners.length < 3) continue;

      const pts = corners.map((c) => this._toContainerPt(map, c.lat, c.lng));

      quads.push({ label: hb.label, pts });

      const isActive = hb.label === this._active;
      const isHovered = hb.label === this._hovered;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();

      if (isActive) {
        ctx.fillStyle = 'rgba(103, 80, 164, 0.25)';
        ctx.strokeStyle = '#6750A4';
        ctx.lineWidth = 2;
      } else if (isHovered) {
        ctx.fillStyle = 'rgba(103, 80, 164, 0.10)';
        ctx.strokeStyle = '#6750A4';
        ctx.lineWidth = 2;
      } else {
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        ctx.strokeStyle = 'rgba(120, 144, 156, 0.6)';
        ctx.lineWidth = 1;
      }

      ctx.fill();
      ctx.stroke();
    }

    this._rendered = quads;
    this._canvas.style.cursor = this._hovered ? 'pointer' : '';
  }

  private _hitTest(clientX: number, clientY: number): string | null {
    const rect = this._canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    // Iterate in reverse so topmost-drawn quad wins
    for (let i = this._rendered.length - 1; i >= 0; i--) {
      const q = this._rendered[i];
      if (pointInPolygon(x, y, q.pts)) return q.label;
    }
    return null;
  }

  private _onMouseMove(e: MouseEvent): void {
    const hit = this._hitTest(e.clientX, e.clientY);
    if (hit !== this._hovered) {
      this._hovered = hit;
      this._scheduleRedraw();
    }
  }

  private _onClick(e: MouseEvent): void {
    const hit = this._hitTest(e.clientX, e.clientY);
    if (hit === null) return;
    this._active = hit === this._active ? null : hit;
    this._scheduleRedraw();
  }

  private _onMouseLeave(): void {
    if (this._hovered !== null) {
      this._hovered = null;
      this._scheduleRedraw();
    }
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this._active !== null) {
      this._active = null;
      this._scheduleRedraw();
    }
  }
}
