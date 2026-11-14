// Grid route planner for TAREEQ.
// Three objectives (shortest / fastest / safest) searched with A* or Dijkstra on an
// 8-connected grid laid over the area between the start and end points.

import { demoTerrain, IMPASSABLE_SLOPE_DEG, TerrainProvider } from './terrain';

export type LonLat = [number, number];
export type RouteObjective = 'shortest' | 'fastest' | 'safest';
export type SearchAlgorithm = 'astar' | 'dijkstra';

export const OBJECTIVES: RouteObjective[] = ['shortest', 'fastest', 'safest'];
export const MARS_RADIUS_M = 3396190;
/** Nominal vehicle speed on flat, smooth ground (5 km/h). */
export const NOMINAL_SPEED_MS = 5000 / 3600;

const DEG = Math.PI / 180;
const MAX_SLOPE_DEG = 40;
/** How strongly the 'safest' objective penalises risky ground (cost = distance * (1 + weight * risk)). */
const SAFETY_WEIGHT = 25;
const MAX_GRID_CELLS = 160; // cells along the longer side of the search area

export interface RouteMetrics {
  distanceM: number;
  timeS: number;
  maxSlopeDeg: number;
  /** 0 (benign) .. 100 (very risky), distance-weighted average along the route */
  riskScore: number;
  expandedNodes: number;
  computeMs: number;
}

export interface RouteResult {
  objective: RouteObjective;
  algorithm: SearchAlgorithm;
  found: boolean;
  path: LonLat[];
  /** objective cost of the path (metres, seconds or risk-weighted metres) */
  cost: number;
  metrics: RouteMetrics;
}

export interface PlanResult {
  routes: Record<RouteObjective, RouteResult>;
  gridCols: number;
  gridRows: number;
  terrainLabel: string;
  error?: string;
}

interface Grid {
  cols: number;
  rows: number;
  minLon: number;
  minLat: number;
  step: number;
  slope: Float32Array;
  rough: Float32Array;
  ok: Uint8Array;
  near: Uint8Array; // 1 = touches an impassable cell
  colM: Float64Array; // metres per column step, per row
  rowM: number; // metres per row step
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  push(key: number, val: number) {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys, v = this.vals;
    const top = v[0];
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    if (k.length > 0) {
      k[0] = lastK; v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function haversineM(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function buildGrid(start: LonLat, end: LonLat, terrain: TerrainProvider, padMult: number): Grid {
  const spanLon = Math.abs(end[0] - start[0]);
  const spanLat = Math.abs(end[1] - start[1]);
  const pad = Math.max(2, 0.35 * Math.max(spanLon, spanLat)) * padMult;
  const minLon = Math.max(-180, Math.min(start[0], end[0]) - pad);
  const maxLon = Math.min(180, Math.max(start[0], end[0]) + pad);
  const minLat = Math.max(-85, Math.min(start[1], end[1]) - pad);
  const maxLat = Math.min(85, Math.max(start[1], end[1]) + pad);
  const step = Math.max(maxLon - minLon, maxLat - minLat) / MAX_GRID_CELLS;
  const cols = Math.ceil((maxLon - minLon) / step) + 1;
  const rows = Math.ceil((maxLat - minLat) / step) + 1;
  const n = cols * rows;

  const slope = new Float32Array(n);
  const rough = new Float32Array(n);
  const ok = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = terrain.sample(minLon + c * step, minLat + r * step);
      const i = r * cols + c;
      slope[i] = s.slopeDeg;
      rough[i] = s.roughness;
      ok[i] = s.passable ? 1 : 0;
    }
  }

  const colM = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    colM[r] = MARS_RADIUS_M * Math.cos((minLat + r * step) * DEG) * step * DEG;
  }
  const rowM = MARS_RADIUS_M * step * DEG;

  const near = new Uint8Array(n);
  return { cols, rows, minLon, minLat, step, slope, rough, ok, near, colM, rowM };
}


/** Free a small square around a point so the vehicle is never boxed in at its own start/finish. */
function clearAround(g: Grid, idx: number, radius = 2): void {
  const c0 = idx % g.cols, r0 = (idx / g.cols) | 0;
  for (let r = Math.max(0, r0 - radius); r <= Math.min(g.rows - 1, r0 + radius); r++) {
    for (let c = Math.max(0, c0 - radius); c <= Math.min(g.cols - 1, c0 + radius); c++) g.ok[r * g.cols + c] = 1;
  }
}

function markNearHazards(g: Grid): void {
  g.near.fill(0);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (!g.ok[r * g.cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < g.rows && nc >= 0 && nc < g.cols && !g.ok[nr * g.cols + nc]) g.near[r * g.cols + c] = 1;
        }
      }
    }
  }
}

function edgeLen(g: Grid, c1: number, r1: number, c2: number, r2: number): number {
  const dx = (c2 - c1) * ((g.colM[r1] + g.colM[r2]) / 2);
  const dy = (r2 - r1) * g.rowM;
  return Math.hypot(dx, dy);
}

function speedFactor(slope: number, rough: number): number {
  return (1 - (0.8 * slope) / MAX_SLOPE_DEG) * (1 - 0.4 * rough);
}

function edgeCost(obj: RouteObjective, g: Grid, i1: number, i2: number, d: number): number {
  if (obj === 'shortest') return d;
  if (obj === 'fastest') {
    const slope = (g.slope[i1] + g.slope[i2]) / 2;
    const rough = (g.rough[i1] + g.rough[i2]) / 2;
    return d / (NOMINAL_SPEED_MS * speedFactor(slope, rough));
  }
  return d * (1 + SAFETY_WEIGHT * edgeRisk(g, i1, i2));
}

function edgeRisk(g: Grid, i1: number, i2: number): number {
  const slope = (g.slope[i1] + g.slope[i2]) / 2;
  const rough = (g.rough[i1] + g.rough[i2]) / 2;
  const near = Math.max(g.near[i1], g.near[i2]);
  return Math.min(1, 0.6 * (slope / MAX_SLOPE_DEG) ** 2 + 0.25 * rough + 0.15 * near);
}

function search(
  g: Grid, obj: RouteObjective, algo: SearchAlgorithm, startIdx: number, goalIdx: number,
): { parent: Int32Array; found: boolean; cost: number; expanded: number } {
  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gc = goalIdx % g.cols, gr = (goalIdx / g.cols) | 0;

  const h = (c: number, r: number) => {
    if (algo !== 'astar') return 0;
    const d = edgeLen(g, c, r, gc, gr);
    return obj === 'fastest' ? d / NOMINAL_SPEED_MS : d; // both are lower bounds on remaining cost
  };

  const heap = new MinHeap();
  gScore[startIdx] = 0;
  heap.push(h(startIdx % g.cols, (startIdx / g.cols) | 0), startIdx);
  let expanded = 0;
  let found = false;

  while (heap.size > 0) {
    const idx = heap.pop();
    if (closed[idx]) continue;
    closed[idx] = 1;
    expanded++;
    if (idx === goalIdx) { found = true; break; }
    const c = idx % g.cols, r = (idx / g.cols) | 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= g.cols || nr < 0 || nr >= g.rows) continue;
        const ni = nr * g.cols + nc;
        if (!g.ok[ni] || closed[ni]) continue;
        if (dr !== 0 && dc !== 0 && (!g.ok[r * g.cols + nc] || !g.ok[nr * g.cols + c])) continue; // no corner cutting
        const ng = gScore[idx] + edgeCost(obj, g, idx, ni, edgeLen(g, c, r, nc, nr));
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          parent[ni] = idx;
          heap.push(ng + h(nc, nr), ni);
        }
      }
    }
  }
  return { parent, found, cost: found ? gScore[goalIdx] : Infinity, expanded };
}

function emptyResult(obj: RouteObjective, algo: SearchAlgorithm, expanded: number, ms: number): RouteResult {
  return {
    objective: obj, algorithm: algo, found: false, path: [], cost: Infinity,
    metrics: { distanceM: 0, timeS: 0, maxSlopeDeg: 0, riskScore: 0, expandedNodes: expanded, computeMs: ms },
  };
}

function runObjective(
  g: Grid, obj: RouteObjective, algo: SearchAlgorithm, start: LonLat, end: LonLat, sIdx: number, gIdx: number,
): RouteResult {
  const t0 = now();
  const res = search(g, obj, algo, sIdx, gIdx);
  if (!res.found) return emptyResult(obj, algo, res.expanded, now() - t0);

  const idxs: number[] = [];
  for (let i = gIdx; i !== -1; i = res.parent[i]) idxs.push(i);
  idxs.reverse();

  let dist = 0, time = 0, riskWeighted = 0, maxSlope = 0;
  for (let k = 0; k < idxs.length; k++) {
    maxSlope = Math.max(maxSlope, g.slope[idxs[k]]);
    if (k === 0) continue;
    const a = idxs[k - 1], b = idxs[k];
    const d = edgeLen(g, a % g.cols, (a / g.cols) | 0, b % g.cols, (b / g.cols) | 0);
    dist += d;
    time += edgeCost('fastest', g, a, b, d);
    riskWeighted += edgeRisk(g, a, b) * d;
  }

  const path: LonLat[] = idxs.map((i) => [g.minLon + (i % g.cols) * g.step, g.minLat + ((i / g.cols) | 0) * g.step]);
  path[0] = start;
  path[path.length - 1] = end;

  return {
    objective: obj, algorithm: algo, found: true, path, cost: res.cost,
    metrics: {
      distanceM: dist, timeS: time, maxSlopeDeg: maxSlope,
      riskScore: dist > 0 ? (riskWeighted / dist) * 100 : 0,
      expandedNodes: res.expanded, computeMs: now() - t0,
    },
  };
}

export function planRoutes(
  start: LonLat, end: LonLat, algorithm: SearchAlgorithm = 'astar', terrain: TerrainProvider = demoTerrain,
): PlanResult {
  const blank = (error: string): PlanResult => ({
    routes: {
      shortest: emptyResult('shortest', algorithm, 0, 0),
      fastest: emptyResult('fastest', algorithm, 0, 0),
      safest: emptyResult('safest', algorithm, 0, 0),
    },
    gridCols: 0, gridRows: 0, terrainLabel: terrain.label, error,
  });

  if (haversineM(start, end) < 2000) return blank('Start and destination are too close. Pick points at least 2 km apart.');

  // If the first search area has no route (a ridge of steep cells blocks it), retry with a wider area.
  for (const padMult of [1, 3]) {
    const g = buildGrid(start, end, terrain, padMult);
    const toIdx = (p: LonLat) => {
      const c = Math.min(g.cols - 1, Math.max(0, Math.round((p[0] - g.minLon) / g.step)));
      const r = Math.min(g.rows - 1, Math.max(0, Math.round((p[1] - g.minLat) / g.step)));
      return r * g.cols + c;
    };
    const sIdx = toIdx(start), gIdx = toIdx(end);
    if (sIdx === gIdx) return blank('Start and destination fall in the same map cell. Pick points further apart.');
    clearAround(g, sIdx);
    clearAround(g, gIdx);
    markNearHazards(g);

    const routes = {} as Record<RouteObjective, RouteResult>;
    for (const obj of OBJECTIVES) routes[obj] = runObjective(g, obj, algorithm, start, end, sIdx, gIdx);
    if (routes.shortest.found || padMult === 3) {
      return { routes, gridCols: g.cols, gridRows: g.rows, terrainLabel: terrain.label };
    }
  }
  return blank('No passable route found between these points.');
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(s: number): string {
  const h = s / 3600;
  if (h < 1) return `${Math.round(s / 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export { IMPASSABLE_SLOPE_DEG };
