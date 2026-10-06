// Deterministic color gradient generator based on track ID/name
// Uses djb2 hash so the same track always gets the same color pair

const PALETTES: [string, string][] = [
  ['#7c3aed', '#2563eb'],  // Purple → Blue
  ['#db2777', '#7c3aed'],  // Pink → Purple
  ['#059669', '#0891b2'],  // Emerald → Cyan
  ['#d97706', '#db2777'],  // Amber → Pink
  ['#2563eb', '#059669'],  // Blue → Emerald
  ['#7c3aed', '#db2777'],  // Purple → Pink
  ['#0891b2', '#7c3aed'],  // Cyan → Purple
  ['#dc2626', '#7c3aed'],  // Red → Purple
  ['#6d28d9', '#0891b2'],  // Violet → Cyan
  ['#c2410c', '#d97706'],  // Orange → Amber
  ['#0f766e', '#2563eb'],  // Teal → Blue
  ['#7c3aed', '#059669'],  // Purple → Emerald
];

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

export function getTrackGradient(seed: string | number): [string, string] {
  const hash = djb2(String(seed));
  return PALETTES[hash % PALETTES.length];
}

/** Returns just the primary color (first in the pair) */
export function getTrackColor(seed: string | number): string {
  return getTrackGradient(seed)[0];
}
