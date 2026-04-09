import L from 'leaflet';
import type { Hitbox, ClusterLayerHandle } from '../types';

interface ScreenQuad {
  label: string;
  pts: { x: number; y: number }[];
}

interface AnimPts {
  label: string;
  start: { x: number; y: number }[];
  end:   { x: number; y: number }[];
}

// Must match .leaflet-zoom-anim transition duration in index.css
const ANIM_DURATION = 400; // ms

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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

  // Zoom animation — canvas sits outside Leaflet's CSS zoom transform.
  // We interpolate quads from their start positions to their end positions
  // over ANIM_DURATION ms, concurrent with the CSS tile animation.
  private _animating = false;
  private _animElapsed = 0;
  private _animLastTime = 0;
  private _animPts: AnimPts[] = [];

  // Bound handlers
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

    map.on('move',     this._boundRedraw);
    map.on('moveend',  this._boundRedraw);
    map.on('zoomanim', this._boundZoomAnim);
    map.on('zoomend',  this._boundZoomEnd);
    map.on('resize',   this._boundResize);

    canvas.addEventListener('mousemove',  this._boundMouseMove);
    canvas.addEventListener('click',      this._boundClick);
    canvas.addEventListener('mouseleave', this._boundMouseLeave);
    document.addEventListener('keydown',  this._boundKeyDown);

    this._scheduleRedraw();
  }

  remove(): void {
    const map = this._map;
    if (!map) return;

    map.off('move',     this._boundRedraw);
    map.off('moveend',  this._boundRedraw);
    map.off('zoomanim', this._boundZoomAnim);
    map.off('zoomend',  this._boundZoomEnd);
    map.off('resize',   this._boundResize);

    this._canvas.removeEventListener('mousemove',  this._boundMouseMove);
    this._canvas.removeEventListener('click',      this._boundClick);
    this._canvas.removeEventListener('mouseleave', this._boundMouseLeave);
    document.removeEventListener('keydown',        this._boundKeyDown);

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
  selectActive(): void  { /* no-op */ }

  // ── Private ──────────────────────────────────────────────────────────

  private _resizeCanvas(): void {
    const map = this._map;
    if (!map) return;
    const container = map.getContainer();
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this._canvas.width  = Math.round(w * dpr);
    this._canvas.height = Math.round(h * dpr);
    this._canvas.style.width  = `${w}px`;
    this._canvas.style.height = `${h}px`;
    this._ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._ctx.scale(dpr, dpr);
  }

  private _scheduleRedraw(): void {
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._redraw();
    });
  }

  private _startAnimLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    const tick = (now: number) => {
      const delta = now - this._animLastTime;
      this._animLastTime = now;
      this._animElapsed += delta;
      this._redraw();
      if (this._animating) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = null;
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  private _onZoomAnim(e: L.ZoomAnimEvent): void {
    const map = this._map;
    if (!map) return;

    this._animating = true;
    this._animElapsed = 0;
    this._animLastTime = performance.now();

    // Snapshot start positions (current zoom) and compute end positions (target zoom).
    // latLngToContainerPoint still reflects the old zoom here — that's the start.
    // map.project(latlng, targetZoom) gives positions in the target zoom's pixel space;
    // subtracting the target center and adding half the viewport gives container coords.
    const mapSize    = map.getSize();
    const endCenterPx = map.project(e.center, e.zoom);

    this._animPts = [];
    for (const hb of this._hitboxes) {
      if (!hb.found || !hb.bbox) continue;
      const corners = hb.bbox.leaflet.corners;
      if (corners.length < 3) continue;

      const start = corners.map((c) => {
        const p = map.latLngToContainerPoint(L.latLng(c.lat, c.lng));
        return { x: p.x, y: p.y };
      });
      const end = corners.map((c) => {
        const pt = map.project(L.latLng(c.lat, c.lng), e.zoom);
        return {
          x: pt.x - endCenterPx.x + mapSize.x / 2,
          y: pt.y - endCenterPx.y + mapSize.y / 2,
        };
      });

      this._animPts.push({ label: hb.label, start, end });
    }

    this._startAnimLoop();
  }

  private _onZoomEnd(): void {
    this._animating = false;
    // Stop the animation loop and do a final settled redraw
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._scheduleRedraw();
  }

  private _redraw(): void {
    const map = this._map;
    if (!map) return;

    const ctx = this._ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this._canvas.width / dpr, this._canvas.height / dpr);

    const quads: ScreenQuad[] = [];

    if (this._animating && this._animPts.length > 0) {
      // Interpolate between start and end positions using the same easing as the CSS animation
      const t = easeOut(Math.min(this._animElapsed / ANIM_DURATION, 1));
      for (const ap of this._animPts) {
        const pts = ap.start.map((sp, i) => ({
          x: sp.x + (ap.end[i].x - sp.x) * t,
          y: sp.y + (ap.end[i].y - sp.y) * t,
        }));
        this._drawQuad(ctx, ap.label, pts, quads);
      }
    } else {
      for (const hb of this._hitboxes) {
        if (!hb.found || !hb.bbox) continue;
        const corners = hb.bbox.leaflet.corners;
        if (corners.length < 3) continue;
        const pts = corners.map((c) => {
          const p = map.latLngToContainerPoint(L.latLng(c.lat, c.lng));
          return { x: p.x, y: p.y };
        });
        this._drawQuad(ctx, hb.label, pts, quads);
      }
    }

    this._rendered = quads;
    this._canvas.style.cursor = this._hovered ? 'pointer' : '';
  }

  private _drawQuad(
    ctx: CanvasRenderingContext2D,
    label: string,
    pts: { x: number; y: number }[],
    quads: ScreenQuad[],
  ): void {
    quads.push({ label, pts });

    const isActive  = label === this._active;
    const isHovered = label === this._hovered;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    if (isActive) {
      ctx.fillStyle   = 'rgba(103, 80, 164, 0.25)';
      ctx.strokeStyle = '#6750A4';
      ctx.lineWidth   = 2;
    } else if (isHovered) {
      ctx.fillStyle   = 'rgba(103, 80, 164, 0.10)';
      ctx.strokeStyle = '#6750A4';
      ctx.lineWidth   = 2;
    } else {
      ctx.fillStyle   = 'rgba(0, 0, 0, 0)';
      ctx.strokeStyle = 'rgba(120, 144, 156, 0.6)';
      ctx.lineWidth   = 1;
    }

    ctx.fill();
    ctx.stroke();
  }

  private _hitTest(clientX: number, clientY: number): string | null {
    const rect = this._canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let i = this._rendered.length - 1; i >= 0; i--) {
      if (pointInPolygon(x, y, this._rendered[i].pts)) return this._rendered[i].label;
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
