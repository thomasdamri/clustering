import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import L from "leaflet";
import MapViewer from "./components/MapViewer";
import { CanvasClusterLayer } from "./components/CanvasClusterLayer";
import { createDefectLayer } from "./components/DefectMarkers";
import { generateDefects, groupDefectsByPos } from "./utils/generateDefects";
import type { TileMeta, LabelManifest } from "./types";

type RendererMode = "canvas" | "leaflet";

export default function App() {
  const [tileMeta, setTileMeta] = useState<TileMeta | null>(null);
  const [manifest, setManifest] = useState<LabelManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RendererMode>("canvas");
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<CanvasClusterLayer | L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/tile_meta.json").then((r) => r.json()),
      fetch("/label-manifest.json").then((r) => r.json()),
    ])
      .then(([meta, man]) => {
        setTileMeta(meta as TileMeta);
        setManifest(man as LabelManifest);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const defects = useMemo(() => {
    if (!manifest) return [];
    return generateDefects(manifest.hitboxes);
  }, [manifest]);

  const defectsByPos = useMemo(() => groupDefectsByPos(defects), [defects]);

  const positionsWithDefects = defectsByPos.size;

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  // Create/destroy the cluster layer whenever mode or data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !manifest || !tileMeta) return;

    if (clusterRef.current) {
      clusterRef.current.remove();
      clusterRef.current = null;
    }

    if (mode === "canvas") {
      const layer = new CanvasClusterLayer(
        manifest.hitboxes,
        defectsByPos,
        tileMeta.leaflet_bounds,
      );
      layer.addTo(map);
      clusterRef.current = layer;
    } else {
      const layer = createDefectLayer(manifest.hitboxes, defectsByPos, map);
      layer.addTo(map);
      clusterRef.current = layer;
    }
  }, [mapReady, mode, manifest, defectsByPos, tileMeta]);

  if (loading) {
    return (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        height="100vh"
        flexDirection="column"
        gap={2}
      >
        <CircularProgress />
        <Typography color="text.secondary">Loading diagram data...</Typography>
      </Box>
    );
  }

  if (error || !tileMeta || !manifest) {
    return (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        height="100vh"
      >
        <Typography color="error">
          Failed to load data: {error ?? "Unknown error"}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100vh", width: "100vw", position: "relative" }}>
      <MapViewer tileMeta={tileMeta} onMapReady={handleMapReady} />

      <Box
        sx={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 1000,
          display: "flex",
          gap: 1,
        }}
      >
        <Chip
          label={`${defects.length} defects`}
          color="error"
          variant="filled"
        />
        <Chip
          label={`${positionsWithDefects} positions affected`}
          color="warning"
          variant="filled"
        />
        <Chip
          label={mode === "canvas" ? "Canvas" : "Leaflet"}
          color="secondary"
          variant={mode === "canvas" ? "filled" : "outlined"}
          onClick={() => setMode((m) => (m === "canvas" ? "leaflet" : "canvas"))}
          sx={{ cursor: "pointer" }}
        />
      </Box>
    </Box>
  );
}
