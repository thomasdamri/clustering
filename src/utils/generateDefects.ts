import type { Hitbox, Defect, Severity } from '../types';

const DEFECT_DESCRIPTIONS = [
  'Corrosion detected on surface',
  'Weld crack identified',
  'Gasket leak observed',
  'Valve misalignment',
  'Pipe wall thinning',
  'Surface pitting',
  'Flange bolt loosening',
  'Seal degradation',
  'Vibration damage',
  'Thermal fatigue cracking',
  'Erosion wear pattern',
  'Insulation breakdown',
];

const SEVERITIES: Severity[] = ['High', 'High', 'High', 'High', 'Med', 'Med', 'Med', 'Low', 'Low'];

function randomSeverity(): Severity {
  return SEVERITIES[Math.floor(Math.random() * SEVERITIES.length)];
}

function weightedDefectCount(): number {
  const r = Math.random();
  if (r < 0.4) return 1;
  if (r < 0.65) return 2;
  if (r < 0.8) return 3;
  if (r < 0.92) return 4;
  return 5;
}

export function generateDefects(hitboxes: Hitbox[]): Defect[] {
  const found = hitboxes.filter((h) => h.found && h.leaflet !== null);
  const defects: Defect[] = [];
  let id = 1;

  for (const hitbox of found) {
    if (Math.random() > 0.3) continue; // ~30% chance of defects

    const count = weightedDefectCount();
    for (let i = 0; i < count; i++) {
      defects.push({
        defectId: `DEF-${String(id++).padStart(5, '0')}`,
        fittingPos: hitbox.label,
        description:
          DEFECT_DESCRIPTIONS[Math.floor(Math.random() * DEFECT_DESCRIPTIONS.length)],
        severity: randomSeverity(),
      });
    }
  }

  return defects;
}

export function groupDefectsByPos(
  defects: Defect[],
): Map<string, Defect[]> {
  const map = new Map<string, Defect[]>();
  for (const d of defects) {
    const list = map.get(d.fittingPos);
    if (list) {
      list.push(d);
    } else {
      map.set(d.fittingPos, [d]);
    }
  }
  return map;
}
