import { useEffect, useRef } from "react";
import L from "leaflet";
import type { TileMeta } from "../types";

interface MapViewerProps {
  tileMeta: TileMeta;
  onMapReady: (map: L.Map) => void;
}

export default function MapViewer({ tileMeta, onMapReady }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bounds = L.latLngBounds(
      L.latLng(tileMeta.leaflet_bounds[0][0], tileMeta.leaflet_bounds[0][1]),
      L.latLng(tileMeta.leaflet_bounds[1][0], tileMeta.leaflet_bounds[1][1]),
    );

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: tileMeta.max_zoom,
      maxBounds: bounds.pad(0.1),
      maxBoundsViscosity: 1.0,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      inertia: false,
    });

    map.fitBounds(bounds);

    L.tileLayer("/tiles/{z}/{x}/{y}.png", {
      tileSize: tileMeta.tile_size,
      noWrap: true,
      maxNativeZoom: tileMeta.max_zoom,
      minNativeZoom: 0,
      minZoom: -2,
      bounds,
      attribution: "",
      updateWhenIdle: true,
    }).addTo(map);

    mapRef.current = map;
    onMapReady(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
