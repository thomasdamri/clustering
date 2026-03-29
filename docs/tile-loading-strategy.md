# Tile Loading Strategy — Leaflet + Nginx

## Context

- ~9,730 WebP tiles, 6 zoom levels (0–5), 256px tiles
- Serving via nginx, consuming via Leaflet in React
- Goal: smooth UX with minimal configuration overhead

---

## Recommendation: On-Demand + Nginx Tuning

**Don't fetch all tiles upfront.** At ~9,730 files you'd hammer the browser's connection pool and waste bandwidth on tiles the user never sees.

**Don't lazy-load naively.** Default Leaflet settings cause visible checkerboard gaps when panning quickly.

**Do: on-demand with buffer tuning + nginx cache headers.**

---

## Leaflet Options to Set

```
keepBuffer: 4         // default is 2 — keeps more tiles alive when panning
updateWhenIdle: false // re-render tiles during pan, not just after
updateInterval: 150   // ms debounce on tile requests while moving
```

`keepBuffer: 4` is the biggest win — it pre-fetches tiles outside the viewport so they're ready before the user pans into them.

---

## Nginx Config (the real lever)

```nginx
location /tilles/ {
    expires max;
    add_header Cache-Control "public, immutable";

    # Enable HTTP/2 (multiplexes tile requests — huge win)
    # Set this on your server{} block, not here

    # Optional: gzip is useless for WebP (already compressed)
    # Don't bother with gzip_types image/webp

    sendfile on;
    tcp_nopush on;
}
```

**HTTP/2 is the most impactful nginx setting.** Browsers limit HTTP/1.1 to ~6 parallel connections per host. With HTTP/2, all tile requests for a viewport fire simultaneously.

---

## Zoom Level Strategy

| Zoom | Tile count (approx) | Strategy |
|------|---------------------|----------|
| 0–1  | <10                 | Could inline these as base64 if wanted |
| 2–3  | ~100–400            | On-demand, loads fast |
| 4–5  | ~2,000–7,000+       | On-demand only, never preload |

Only consider preloading zoom 0 and 1 (the "zoomed out" overview tiles) — these are few enough to fetch eagerly on app load and give instant feedback when the user first opens the map.

---

## What to Avoid

- **Fetching all tiles on load** — too many files, wastes bandwidth, blocks real requests
- **Service Workers for tile caching** — adds complexity; nginx `Cache-Control: immutable` achieves the same result on repeat visits
- **Custom tile queuing logic** — Leaflet already does this well; tune it, don't replace it

---

## Summary

1. Set `keepBuffer: 4` in Leaflet `TileLayer` options
2. Set `Cache-Control: public, immutable` on `/tilles/` in nginx
3. Enable HTTP/2 on your nginx server
4. Optionally prefetch zoom 0–1 tiles on app mount (< 10 files)

That's it. No service workers, no custom fetch queues, no preload manifests.
