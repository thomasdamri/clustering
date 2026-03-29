import L from 'leaflet';
import 'leaflet.markercluster';
import type { Hitbox, Defect } from '../types';

// leaflet.markercluster event types are incomplete — cluster events expose
// .layer/.propagatedFrom with methods like getChildCount(), getAllChildMarkers(),
// getElement(), getBounds(), getLatLng() that aren't in the type definitions.
type ClusterEvent = L.LeafletEvent & {
  layer: L.MarkerCluster;
  propagatedFrom: L.MarkerCluster;
};

type DefectMarker = L.Marker & {
  _defects?: Defect[];
  _position?: string;
};

function buildPopoverHTML(defects: Defect[]): string {
  const rows = defects
    .map(
      (d) =>
        `<div class="defect-popover-row" data-defect-id="${d.defectId}">
          <span class="defect-popover-id">${d.defectId}</span>
          <span class="defect-popover-desc">${d.description}</span>
        </div>`,
    )
    .join('');

  return `<div class="defect-popover">
    <div class="defect-popover-header">${defects.length} DEFECT${defects.length > 1 ? 'S' : ''}</div>
    <div class="defect-popover-body">${rows}</div>
  </div>`;
}

function attachRowClickHandlers(
  popup: L.Popup,
  clusterEl: HTMLElement,
  setSelected: (el: HTMLElement) => void,
) {
  requestAnimationFrame(() => {
    const container = popup.getElement();
    if (!container) return;

    container.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest(
        '.defect-popover-row',
      ) as HTMLElement | null;
      if (!row) return;

      container
        .querySelectorAll('.defect-popover-row-selected')
        .forEach((el) => el.classList.remove('defect-popover-row-selected'));

      row.classList.add('defect-popover-row-selected');
      setSelected(clusterEl);
    });
  });
}

export function createDefectLayer(
  hitboxes: Hitbox[],
  defectsByPos: Map<string, Defect[]>,
  map: L.Map,
): L.MarkerClusterGroup {
  const cluster = L.markerClusterGroup({
    maxClusterRadius: 30,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    disableClusteringAtZoom: 4,
    zoomToBoundsOnClick: false,
    iconCreateFunction: (clusterObj) => {
      const count = clusterObj.getChildCount();

      let size: 'small' | 'medium' | 'large' | 'xl';
      let px: number;

      if (count >= 16) {
        size = 'xl';
        px = 52;
      } else if (count >= 6) {
        size = 'large';
        px = 44;
      } else if (count >= 2) {
        size = 'medium';
        px = 36;
      } else {
        size = 'small';
        px = 28;
      }

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
  let activePopup: L.Popup | null = null;
  let selectedElement: HTMLElement | null = null;

  function clearActive() {
    if (activeElement) {
      activeElement.classList.remove('defect-cluster-active');
      activeElement = null;
    }
    if (activePopup) {
      map.closePopup(activePopup);
      activePopup = null;
    }
  }

  function clearSelected() {
    if (selectedElement) {
      selectedElement.classList.remove('defect-cluster-selected');
      selectedElement = null;
    }
  }

  function setActive(el: HTMLElement, popup: L.Popup) {
    clearActive();
    el.classList.add('defect-cluster-active');
    activeElement = el;
    activePopup = popup;
  }

  function setSelected(el: HTMLElement) {
    clearSelected();
    clearActive();
    el.classList.add('defect-cluster-selected');
    selectedElement = el;
  }

  // --- Escape key handler ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearActive();
      clearSelected();
    }
  });

  // --- Cluster tooltip on hover ---
  cluster.on('clustermouseover', (e: L.LeafletEvent) => {
    const ce = e as ClusterEvent;
    const clusterLayer = ce.propagatedFrom ?? ce.layer;
    const count = clusterLayer.getChildCount();
    clusterLayer
      .bindTooltip(`${count} defect${count > 1 ? 's' : ''}`, {
        direction: 'top' as L.Direction,
        className: 'defect-tooltip',
      })
      .openTooltip();
  });

  cluster.on('clustermouseout', (e: L.LeafletEvent) => {
    const ce = e as ClusterEvent;
    const clusterLayer = ce.propagatedFrom ?? ce.layer;
    clusterLayer.unbindTooltip();
  });

  // --- Cluster click handler ---
  cluster.on('clusterclick', (e: L.LeafletEvent) => {
    const clusterLayer = (e as ClusterEvent).layer;
    const icon = clusterLayer.getElement?.();
    if (!icon) return;

    const childMarkers = clusterLayer.getAllChildMarkers();
    const allDefects: Defect[] = [];
    for (const m of childMarkers) {
      const d = (m as DefectMarker)._defects;
      if (d) allDefects.push(...d);
    }

    // Zoom-to-fit if zoomed out
    const clusterBounds = clusterLayer.getBounds();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MarkerClusterGroupOptions type doesn't include disableClusteringAtZoom
    const disableZoom = (cluster.options as any).disableClusteringAtZoom ?? 4;
    if (map.getZoom() < disableZoom - 1) {
      map.flyToBounds(clusterBounds.pad(0.3), { duration: 0.3 });
      return;
    }

    if (allDefects.length <= 1) {
      setSelected(icon);
      return;
    }

    // Show popover
    const popup = L.popup({
      className: 'defect-popover-popup',
      closeButton: false,
      autoClose: true,
      closeOnClick: true,
      maxWidth: 220,
      minWidth: 220,
    })
      .setLatLng(clusterLayer.getLatLng())
      .setContent(buildPopoverHTML(allDefects));

    popup.on('remove', () => {
      if (activeElement === icon) {
        activeElement?.classList.remove('defect-cluster-active');
        activeElement = null;
        activePopup = null;
      }
    });

    popup.openOn(map);
    setActive(icon, popup);
    attachRowClickHandlers(popup, icon, setSelected);
  });

  // --- Create individual markers ---
  const hitboxMap = new Map<string, Hitbox>();
  for (const h of hitboxes) {
    hitboxMap.set(h.label, h);
  }

  for (const [pos, defects] of defectsByPos) {
    const hitbox = hitboxMap.get(pos);
    if (!hitbox) continue;

    const { lat, lng } = hitbox.leaflet;
    const count = defects.length;

    let size: 'small' | 'medium' | 'large' | 'xl';
    let px: number;

    if (count >= 16) {
      size = 'xl';
      px = 52;
    } else if (count >= 6) {
      size = 'large';
      px = 44;
    } else if (count >= 2) {
      size = 'medium';
      px = 36;
    } else {
      size = 'small';
      px = 28;
    }

    const marker = L.marker(L.latLng(lat, lng), {
      icon: L.divIcon({
        html: `<div><span>${count >= 16 ? '16+' : String(count)}</span></div>`,
        className: `defect-cluster defect-cluster-${size}`,
        iconSize: L.point(px, px),
        iconAnchor: L.point(px / 2, px / 2),
      }),
    });

    // Store defects on marker for retrieval in cluster click
    (marker as DefectMarker)._defects = defects;
    (marker as DefectMarker)._position = pos;

    // Tooltip
    marker.bindTooltip(`${count} defect${count > 1 ? 's' : ''}`, {
      direction: 'top',
      offset: L.point(0, -px / 2),
      className: 'defect-tooltip',
    });

    // Click handler
    marker.on('click', () => {
      const el = marker.getElement();
      if (!el) return;

      if (count === 1) {
        setSelected(el);
        return;
      }

      const popup = L.popup({
        className: 'defect-popover-popup',
        closeButton: false,
        autoClose: true,
        closeOnClick: true,
        maxWidth: 220,
        minWidth: 220,
        offset: L.point(0, -px / 2 - 4),
      })
        .setLatLng(marker.getLatLng())
        .setContent(buildPopoverHTML(defects));

      popup.on('remove', () => {
        if (activeElement === el) {
          activeElement?.classList.remove('defect-cluster-active');
          activeElement = null;
          activePopup = null;
        }
      });

      popup.openOn(map);
      setActive(el, popup);
      attachRowClickHandlers(popup, el, setSelected);
    });

    cluster.addLayer(marker);
  }

  return cluster;
}
