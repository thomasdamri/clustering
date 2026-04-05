// ── Types ─────────────────────────────────────────────────────────────────────

export interface MarkerSnapshot<F = unknown> {
  id: string;
  x: number;
  y: number;
  radius: number;
  count: number;
  feature: F;
}

export interface FrameMarker<F = unknown> {
  id: string;
  x: number;
  y: number;
  radius: number;
  opacity: number;
  count: number;
  feature: F;
}

/**
 * Per-marker overrides that give the animator spatial context for
 * the cluster split/merge animation.
 *
 * fromOverrides — for *appearing* markers: where to start sliding from
 *   (the old cluster they emerged from).
 *
 * toOverrides — for *departing* markers: where to slide toward
 *   (the new cluster that absorbed them, or their projected off-screen position).
 */
export interface TransitionOverrides {
  fromOverrides?: Map<string, { x: number; y: number; radius: number }>;
  toOverrides?:   Map<string, { x: number; y: number }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POSITION_DURATION = 400; // ms — must match .leaflet-zoom-anim transition in index.css

// ── Easing ────────────────────────────────────────────────────────────────────

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── ClusterAnimator ───────────────────────────────────────────────────────────

export class ClusterAnimator<F = unknown> {
  private _from = new Map<string, MarkerSnapshot<F>>();
  private _to   = new Map<string, MarkerSnapshot<F>>();
  private _fromOverrides = new Map<string, { x: number; y: number; radius: number }>();
  private _toOverrides   = new Map<string, { x: number; y: number }>();
  private _elapsed = 0;
  private _active  = false;

  get isAnimating(): boolean {
    return this._active;
  }

  snapshot(markers: MarkerSnapshot<F>[]): void {
    this._from = new Map(markers.map(m => [m.id, { ...m }]));
  }

  transition(markers: MarkerSnapshot<F>[], overrides?: TransitionOverrides): void {
    this._to             = new Map(markers.map(m => [m.id, { ...m }]));
    this._fromOverrides  = overrides?.fromOverrides ?? new Map();
    this._toOverrides    = overrides?.toOverrides   ?? new Map();
    this._elapsed        = 0;
    this._active         = true;
  }

  advance(deltaMs: number): void {
    if (!this._active) return;
    this._elapsed += deltaMs;
    if (this._elapsed >= POSITION_DURATION) {
      this._active = false;
    }
  }

  getFrame(): FrameMarker<F>[] {
    const result: FrameMarker<F>[] = [];
    const t = easeOut(clamp(this._elapsed / POSITION_DURATION, 0, 1));

    // ── Continuing + appearing (everything in destination) ────────────────────
    for (const [id, to] of this._to) {
      const from   = this._from.get(id);
      const origin = from ?? this._fromOverrides.get(id);

      if (origin) {
        // Slide from old position (or parent cluster) to new position
        result.push({
          id,
          x:       origin.x      + (to.x      - origin.x)      * t,
          y:       origin.y      + (to.y      - origin.y)      * t,
          radius:  origin.radius + (to.radius - origin.radius) * t,
          opacity: 1,
          count:   to.count,
          feature: to.feature,
        });
      } else {
        // No positional context — render at final position immediately
        result.push({
          id,
          x: to.x, y: to.y, radius: to.radius,
          opacity: 1,
          count:   to.count,
          feature: to.feature,
        });
      }
    }

    // ── Departing (in old layout, not in new) ─────────────────────────────────
    for (const [id, from] of this._from) {
      if (this._to.has(id)) continue;

      const dest = this._toOverrides.get(id);
      if (!dest) continue; // no destination context — drop immediately

      result.push({
        id,
        x:       from.x + (dest.x - from.x) * t,
        y:       from.y + (dest.y - from.y) * t,
        radius:  from.radius,
        opacity: 1,
        count:   from.count,
        feature: from.feature,
      });
    }

    return result;
  }
}
