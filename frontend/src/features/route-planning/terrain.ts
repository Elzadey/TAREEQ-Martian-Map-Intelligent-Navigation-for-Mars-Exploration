// Terrain model used by the route planner.
//
// IMPORTANT: the default provider below is a DEMO terrain (deterministic procedural noise),
// not real Mars data. It exists so the planner works with no backend and no DEM download.
// To use real elevation (e.g. MOLA), implement TerrainProvider and pass it to planRoutes().

export interface TerrainSample {
  /** metres relative to the datum (display only) */
  elevation: number;
  /** local slope in degrees */
  slopeDeg: number;
  /** surface roughness, 0 (smooth) .. 1 (very rough) */
  roughness: number;
  /** false = the vehicle cannot enter this cell (too steep / hazard) */
  passable: boolean;
}

export interface TerrainProvider {
  id: string;
  label: string;
  sample(lon: number, lat: number): TerrainSample;
}

/** Slope (degrees) at or above which a cell is treated as impassable. */
export const IMPASSABLE_SLOPE_DEG = 32;

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function fbm(x: number, y: number, seed: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export const demoTerrain: TerrainProvider = {
  id: 'demo-procedural',
  label: 'Demo terrain (synthetic, not real Mars data)',
  sample(lon: number, lat: number): TerrainSample {
    const elevation = -2000 + 9000 * fbm(lon / 12, lat / 12, 1);
    const s = fbm(lon / 2.5, lat / 2.5, 2);
    const slopeDeg = Math.min(1, Math.max(0, (s - 0.3) / 0.45)) * 40;
    const roughness = fbm(lon / 1.2, lat / 1.2, 3);
    return { elevation, slopeDeg, roughness, passable: slopeDeg < IMPASSABLE_SLOPE_DEG };
  },
};
