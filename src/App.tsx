import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import L from 'leaflet';
import MapViewer from './components/MapViewer';
import ClusterOverlay from './components/ClusterOverlay';
import { CanvasClusterLayer } from './components/CanvasClusterLayer';
import { createDefectLayer } from './components/DefectMarkers';
import { generateDefects, groupDefectsByPos } from './utils/generateDefects';
import type {
  TileMeta,
  Hitbox,
  HoveredCluster,
  ActiveCluster,
  LayerCallbacks,
  ClusterLayerHandle,
} from './types';

type RendererMode = 'canvas' | 'leaflet';

export default function App() {
  const [tileMeta, setTileMeta] = useState<TileMeta | null>(null);
  const [hitboxes, setHitboxes] = useState<Hitbox[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RendererMode>('canvas');
  const [mapReady, setMapReady] = useState(false);

  // Overlay state
  const [hoveredCluster, setHoveredCluster] = useState<HoveredCluster | null>(null);
  const [activeCluster, setActiveCluster] = useState<ActiveCluster | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<ClusterLayerHandle | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/tile_meta.json').then((r) => r.json()),
      fetch('/hitboxes.json').then((r) => r.json()),
    ])
      .then(([meta, hb]) => {
        setTileMeta(meta as TileMeta);
        setHitboxes(hb as Hitbox[]);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const defects = useMemo(() => {
    if (!hitboxes) return [];
    return generateDefects(hitboxes);
  }, [hitboxes]);

  const defectsByPos = useMemo(() => groupDefectsByPos(defects), [defects]);

  const positionsWithDefects = defectsByPos.size;

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  // Callbacks fired by the layer into React state
  const layerCallbacks = useMemo<LayerCallbacks>(
    () => ({
      onHover: (c) => setHoveredCluster(c),
      onHoverEnd: () => setHoveredCluster(null),
      onClusterClick: (c) => setActiveCluster(c),
      // Called by canvas Escape key — layer already cleared its own visual state
      onDismiss: () => {
        setHoveredCluster(null);
        setActiveCluster(null);
      },
    }),
    [],
  );

  // Called when MUI Popover closes (click-outside or its own Escape handling)
  const handleOverlayDismiss = useCallback(() => {
    clusterRef.current?.clearActive();
    setHoveredCluster(null);
    setActiveCluster(null);
  }, []);

  // Called when user selects a defect row in the MUI Popover
  const handleDefectSelect = useCallback((_defectId: string) => {
    clusterRef.current?.selectActive();
    setActiveCluster(null);
  }, []);

  // Create/destroy cluster layer when mode or data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !hitboxes || !tileMeta) return;

    if (clusterRef.current) {
      clusterRef.current.remove();
      clusterRef.current = null;
      setHoveredCluster(null);
      setActiveCluster(null);
    }

    if (mode === 'canvas') {
      const layer = new CanvasClusterLayer(
        hitboxes,
        defectsByPos,
        tileMeta.leaflet_bounds,
        layerCallbacks,
      );
      layer.addTo(map);
      clusterRef.current = layer;
    } else {
      const handle = createDefectLayer(
        hitboxes,
        defectsByPos,
        map,
        layerCallbacks,
      );
      handle.addTo(map);
      clusterRef.current = handle;
    }
  }, [mapReady, mode, hitboxes, defectsByPos, tileMeta, layerCallbacks]);

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

  if (error || !tileMeta || !hitboxes) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100vh">
        <Typography color="error">
          Failed to load data: {error ?? 'Unknown error'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', width: '100vw', position: 'relative' }}>
      <MapViewer tileMeta={tileMeta} onMapReady={handleMapReady} />

      <ClusterOverlay
        hoveredCluster={hoveredCluster}
        activeCluster={activeCluster}
        onDefectSelect={handleDefectSelect}
        onDismiss={handleOverlayDismiss}
      />

      <Box
        sx={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 1000,
          display: 'flex',
          gap: 1,
        }}
      >
        <Chip label={`${defects.length} defects`} color="error" variant="filled" />
        <Chip
          label={`${positionsWithDefects} positions affected`}
          color="warning"
          variant="filled"
        />
        <Chip
          label={mode === 'canvas' ? 'Canvas' : 'Leaflet'}
          color="secondary"
          variant={mode === 'canvas' ? 'filled' : 'outlined'}
          onClick={() => setMode((m) => (m === 'canvas' ? 'leaflet' : 'canvas'))}
          sx={{ cursor: 'pointer' }}
        />
      </Box>
    </Box>
  );
}
