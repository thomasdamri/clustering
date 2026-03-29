export interface TileMeta {
  max_zoom: number;
  tile_size: number;
  leaflet_bounds: [[number, number], [number, number]];
}

export interface Hitbox {
  label: string;
  found: boolean;
  leaflet: {
    lat: number;
    lng: number;
  };
}

export interface LabelManifest {
  version: string;
  hitboxes: Hitbox[];
}

export interface Defect {
  defectId: string;
  fittingPos: string;
  description: string;
}
