export interface TileMeta {
  max_zoom: number;
  tile_size: number;
  leaflet_bounds: [[number, number], [number, number]];
}

export interface Hitbox {
  label: string;
  found: boolean;
  leaflet: { lat: number; lng: number } | null;
}

export type Severity = 'High' | 'Med' | 'Low';

export interface Defect {
  defectId: string;
  fittingPos: string;
  description: string;
  severity: Severity;
}

export interface HoveredCluster {
  x: number;
  y: number;
  count: number;
}

export interface ActiveCluster {
  x: number;
  y: number;
  defects: Defect[];
}

export interface LayerCallbacks {
  onHover: (cluster: HoveredCluster) => void;
  onHoverEnd: () => void;
  onClusterClick: (cluster: ActiveCluster) => void;
  onDismiss: () => void;
}

export interface ClusterLayerHandle {
  addTo: (map: import('leaflet').Map) => void;
  remove: () => void;
  clearActive: () => void;
  clearSelected: () => void;
  selectActive: () => void;
}
