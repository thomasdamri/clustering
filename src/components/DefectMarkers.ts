import L from 'leaflet';
import 'leaflet.markercluster';
import type { Hitbox, Defect, LayerCallbacks, ClusterLayerHandle } from '../types';

type ClusterEvent = L.LeafletEvent & {
  layer: L.MarkerCluster;
  propagatedFrom: L.MarkerCluster;
};

type DefectMarker = L.Marker & {
  _defects?: Defect[];
  _position?: string;
};

const _clusterCountCache = new WeakMap<L.MarkerCluster, number>();

function totalDefectCount(clusterObj: L.MarkerCluster): number {
  const cached = _clusterCountCache.get(clusterObj);
  if (cached !== undefined) return cached;
  const count = clusterObj.getAllChildMarkers().reduce((sum, m) => {
    return sum + ((m as DefectMarker)._defects?.length ?? 0);
  }, 0);
  _clusterCountCache.set(clusterObj, count);
  return count;
}

export function createDefectLayer(
  hitboxes: Hitbox[],
  defectsByPos: Map<string, Defect[]>,
  map: L.Map,
  callbacks?: LayerCallbacks,
): ClusterLayerHandle {
  const cluster = L.markerClusterGroup({
    maxClusterRadius: 60,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    disableClusteringAtZoom: 4,
    zoomToBoundsOnClick: false,
    animate: false,
    iconCreateFunction: (clusterObj) => {
      const count = totalDefectCount(clusterObj);

      let size: 'small' | 'medium' | 'large' | 'xl';
      let px: number;

      if (count >= 16) { size = 'xl'; px = 52; }
      else if (count >= 6) { size = 'large'; px = 44; }
      else if (count >= 2) { size = 'medium'; px = 36; }
      else { size = 'small'; px = 28; }

      const label = count >= 16 ? '16+' : String(count);

      return L.divIcon({
        html: `<div><span>${label}</span></div>`,
        className: `defect-cluster defect-cluster-${size}`,
        iconSize: L.point(px, px),
        iconAnchor: L.point(px / 2, px / 2),
      });
    },
  });

  // --- State management ---
  let activeElement: HTMLElement | null = null;
  let selectedElement: HTMLElement | null = null;
  // Tracks the active mousemove listener for cursor-following tooltip
  let hoverMoveHandler: ((e: MouseEvent) => void) | null = null;

  function clearHoverTracking() {
    if (hoverMoveHandler) {
      map.getContainer().removeEventListener('mousemove', hoverMoveHandler);
      hoverMoveHandler = null;
      callbacks?.onHoverEnd();
    }
  }

  function clearActive() {
    if (activeElement) {
      activeElement.classList.remove('defect-cluster-active');
      activeElement = null;
    }
  }

  function clearSelected() {
    if (selectedElement) {
      selectedElement.classList.remove('defect-cluster-selected');
      selectedElement = null;
    }
  }

  function setActive(el: HTMLElement) {
    clearActive();
    el.classList.add('defect-cluster-active');
    activeElement = el;
  }

  function setSelected(el: HTMLElement) {
    clearSelected();
    clearActive();
    el.classList.add('defect-cluster-selected');
    selectedElement = el;
  }

  function selectActive() {
    if (activeElement) setSelected(activeElement);
  }

  // --- Escape key handler ---
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') {
      return;
    }
    const hadActive = !!activeElement;
    clearActive();
    clearSelected();
    clearHoverTracking();
    if (hadActive) callbacks?.onDismiss();
  };
  document.addEventListener('keydown', onKeyDown);

  // --- Cluster hover: cursor-following tooltip ---
  cluster.on('clustermouseover', (e: L.LeafletEvent) => {
    const ce = e as ClusterEvent;
    const clusterLayer = ce.propagatedFrom ?? ce.layer;
    const count = totalDefectCount(clusterLayer);
    const me = (e as unknown as { originalEvent: MouseEvent }).originalEvent;

    callbacks?.onHover({ x: me.clientX, y: me.clientY, count });

    // Track mouse position within cluster for cursor following
    hoverMoveHandler = (moveEvent: MouseEvent) => {
      callbacks?.onHover({ x: moveEvent.clientX, y: moveEvent.clientY, count });
    };
    map.getContainer().addEventListener('mousemove', hoverMoveHandler);
  });

  cluster.on('clustermouseout', () => {
    clearHoverTracking();
  });

  map.on('movestart', clearHoverTracking);

  cluster.on('remove', () => {
    document.removeEventListener('keydown', onKeyDown);
    map.off('movestart', clearHoverTracking);
    clearHoverTracking();
  });

  // --- Cluster click handler ---
  cluster.on('clusterclick', (e: L.LeafletEvent) => {
    clearHoverTracking();
    const clusterLayer = (e as ClusterEvent).layer;
    const icon = clusterLayer.getElement?.();
    if (!icon) return;

    const childMarkers = clusterLayer.getAllChildMarkers();
    const allDefects: Defect[] = [];
    for (const m of childMarkers) {
      const d = (m as DefectMarker)._defects;
      if (d) allDefects.push(...d);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disableZoom = (cluster.options as any).disableClusteringAtZoom ?? 4;
    if (map.getZoom() < disableZoom - 1) {
      map.flyToBounds(clusterLayer.getBounds().pad(0.3), { duration: 0.3 });
      return;
    }

    if (allDefects.length <= 1) {
      setSelected(icon);
      return;
    }

    const me = (e as unknown as { originalEvent: MouseEvent }).originalEvent;
    setActive(icon);
    callbacks?.onClusterClick({ x: me.clientX, y: me.clientY, defects: allDefects });
  });

  // --- Create individual markers ---
  const hitboxMap = new Map<string, Hitbox>();
  for (const h of hitboxes) hitboxMap.set(h.label, h);

  for (const [pos, defects] of defectsByPos) {
    const hitbox = hitboxMap.get(pos);
    if (!hitbox || !hitbox.leaflet) continue;

    const { lat, lng } = hitbox.leaflet;
    const count = defects.length;

    let size: 'small' | 'medium' | 'large' | 'xl';
    let px: number;

    if (count >= 16) { size = 'xl'; px = 52; }
    else if (count >= 6) { size = 'large'; px = 44; }
    else if (count >= 2) { size = 'medium'; px = 36; }
    else { size = 'small'; px = 28; }

    const marker = L.marker(L.latLng(lat, lng), {
      icon: L.divIcon({
        html: `<div><span>${count >= 16 ? '16+' : String(count)}</span></div>`,
        className: `defect-cluster defect-cluster-${size}`,
        iconSize: L.point(px, px),
        iconAnchor: L.point(px / 2, px / 2),
      }),
    });

    (marker as DefectMarker)._defects = defects;
    (marker as DefectMarker)._position = pos;

    // Marker hover — cursor-following tooltip
    marker.on('mouseover', (e) => {
      const me = (e as L.LeafletMouseEvent).originalEvent;
      callbacks?.onHover({ x: me.clientX, y: me.clientY, count });

      hoverMoveHandler = (moveEvent: MouseEvent) => {
        callbacks?.onHover({ x: moveEvent.clientX, y: moveEvent.clientY, count });
      };
      map.getContainer().addEventListener('mousemove', hoverMoveHandler);
    });

    marker.on('mouseout', () => {
      clearHoverTracking();
    });

    // Marker click
    marker.on('click', (e) => {
      clearHoverTracking();
      const el = marker.getElement();
      if (!el) return;

      if (count === 1) {
        setSelected(el);
        return;
      }

      const me = (e as L.LeafletMouseEvent).originalEvent;
      setActive(el);
      callbacks?.onClusterClick({ x: me.clientX, y: me.clientY, defects });
    });

    cluster.addLayer(marker);
  }

  const handle: ClusterLayerHandle = {
    addTo: (m) => { cluster.addTo(m); },
    remove: () => { cluster.remove(); },
    clearActive,
    clearSelected,
    selectActive,
  };

  return handle;
}
