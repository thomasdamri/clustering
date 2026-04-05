export interface Point2D {
  x: number;
  y: number;
}

function cross(O: Point2D, A: Point2D, B: Point2D): number {
  return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
}

/**
 * Computes the convex hull of a set of 2D points using Jarvis March (gift wrapping).
 * Returns vertices in counter-clockwise order (screen coords: Y-down, so visually clockwise).
 * Returns the input array unchanged for 0, 1, or 2 points.
 */
export function convexHull(points: Point2D[]): Point2D[] {
  const n = points.length;
  if (n < 3) return points.slice();

  // Find the leftmost point (min x, break ties by min y)
  let startIdx = 0;
  for (let i = 1; i < n; i++) {
    if (
      points[i].x < points[startIdx].x ||
      (points[i].x === points[startIdx].x && points[i].y < points[startIdx].y)
    ) {
      startIdx = i;
    }
  }

  const hull: Point2D[] = [];
  let current = startIdx;

  do {
    hull.push(points[current]);
    let next = (current + 1) % n;

    for (let i = 0; i < n; i++) {
      if (i === current) continue;
      const c = cross(points[current], points[i], points[next]);
      // c < 0 means points[i] is more counter-clockwise than points[next]
      // c === 0 means collinear — prefer the farther point to avoid missing hull edges
      if (c < 0) {
        next = i;
      } else if (c === 0) {
        const d1 =
          (points[i].x - points[current].x) ** 2 +
          (points[i].y - points[current].y) ** 2;
        const d2 =
          (points[next].x - points[current].x) ** 2 +
          (points[next].y - points[current].y) ** 2;
        if (d1 > d2) next = i;
      }
    }

    current = next;
  } while (current !== startIdx && hull.length <= n);

  return hull;
}
