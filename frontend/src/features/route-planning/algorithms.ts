// TAREEQ route planning: three uninformed/informed search algorithms on a Mars terrain grid.
//
//   Greedy Best-First : priority = h(n)         (ignores cost, only chases the goal)  -> fastest search, not optimal
//   Uniform-Cost (UCS): priority = g(n)         (safety-weighted cost)                -> safest, optimal for that cost, longer
//   A*                : priority = g(n) + h(n)  (balanced cost + straight-line h)     -> optimal for its cost, short
//
// UCS and A* optimise different cost functions on purpose (safety-first vs balanced);
// with the same cost they would return the same path (A* just expands fewer nodes).

export type LonLat = [number, number];
export type AlgoId = "astar" | "ucs" | "greedy";

export interface PlanningBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface AlgoConfig {
  name: string;
  tagline: string;
  description: string;
  color: string;
  maxSlope: number; // deg: steeper edges are impassable
  slopeScale: number; // deg: cost = distance * (1 + (slope / scale)^2); smaller = more cautious
}

export const ALGORITHMS: Record<AlgoId, AlgoConfig> = {
  astar: {
    name: "A*",
    tagline: "Best route",
    description: "Optimal cost with a heuristic: short and reasonably safe.",
    color: "#3b82f6",
    maxSlope: 22,
    slopeScale: 12,
  },
  ucs: {
    name: "Uniform-Cost Search",
    tagline: "Safest route",
    description: "Lowest-risk path: avoids slopes, but longer.",
    color: "#22c55e",
    maxSlope: 14,
    slopeScale: 5,
  },
  greedy: {
    name: "Greedy Best-First",
    tagline: "Fastest search",
    description:
      "Ignores cost and heads straight for the goal: quick to find, riskier.",
    color: "#f97316",
    maxSlope: 30,
    slopeScale: 12,
  },
};

export const ALGO_ORDER: AlgoId[] = ["astar", "ucs", "greedy"];

export interface RouteResult {
  id: AlgoId;
  name: string;
  tagline: string;
  description: string;
  color: string;
  path?: LonLat[];
  error?: string;
  length_km?: number;
  estimated_time_hours?: number;
  max_slope_deg?: number;
  avg_slope_deg?: number;
  risk_score?: number;
  nodes_expanded?: number;
  slope_limit_deg?: number;
  relaxed_constraints?: boolean;
}

export interface RoutePlanResponse {
  routes: RouteResult[];
  grid: { cols: number; rows: number; cell_km: number };
  terrain: string;
}

// ---------------------------------------------------------------------------
// Route geometry is always available; elevation constraints are only applied when a DEM is supplied.
// ---------------------------------------------------------------------------
const MARS_RADIUS_KM = 3396.19;
const KM_PER_DEG = (MARS_RADIUS_KM * Math.PI) / 180;
const ROVER_MAX_SPEED_KMH = 0.15;
const MAX_CELLS = 22500;
const MIN_CELL_KM = 0.5;

const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;

export const haversineKm = (a: LonLat, b: LonLat): number => {
  const lat1 = rad(a[1]);
  const lat2 = rad(b[1]);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const slopeDeg = (dzM: number, distKm: number) =>
  distKm <= 0
    ? 0
    : (Math.atan(Math.abs(dzM) / (distKm * 1000)) * 180) / Math.PI;

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
interface Grid {
  minLon: number;
  minLat: number;
  nx: number;
  ny: number;
  dlon: number;
  dlat: number;
  cellKm: number;
  elev: Float64Array;
}

const coordOf = (g: Grid, i: number, j: number): LonLat => [
  g.minLon + i * g.dlon,
  g.minLat + j * g.dlat,
];
const cellOf = (g: Grid, p: LonLat): number =>
  clamp(Math.round((p[1] - g.minLat) / g.dlat), 0, g.ny - 1) * g.nx +
  clamp(Math.round((p[0] - g.minLon) / g.dlon), 0, g.nx - 1);

function buildGrid(
  start: LonLat,
  goal: LonLat,
  elevationValues?: Float64Array,
  bounds?: PlanningBounds
): Grid {
  if (
    bounds &&
    (start[0] < bounds.west ||
      start[0] > bounds.east ||
      start[1] < bounds.south ||
      start[1] > bounds.north ||
      goal[0] < bounds.west ||
      goal[0] > bounds.east ||
      goal[1] < bounds.south ||
      goal[1] > bounds.north)
  ) {
    throw new Error(
      "Start and destination must both be inside the selected DEM coverage."
    );
  }
  const padLon = Math.max(1, 0.5 * Math.abs(goal[0] - start[0]));
  const padLat = Math.max(1, 0.5 * Math.abs(goal[1] - start[1]));
  const minLon =
    bounds?.west ?? clamp(Math.min(start[0], goal[0]) - padLon, -180, 180);
  const maxLon =
    bounds?.east ?? clamp(Math.max(start[0], goal[0]) + padLon, -180, 180);
  const minLat =
    bounds?.south ?? clamp(Math.min(start[1], goal[1]) - padLat, -85, 85);
  const maxLat =
    bounds?.north ?? clamp(Math.max(start[1], goal[1]) + padLat, -85, 85);
  const cosMid = Math.max(0.2, Math.cos(rad((minLat + maxLat) / 2)));
  const widthKm = (maxLon - minLon) * cosMid * KM_PER_DEG;
  const heightKm = (maxLat - minLat) * KM_PER_DEG;
  const minimumCellKm = bounds ? 0.1 : MIN_CELL_KM;
  const cellKm = Math.max(
    minimumCellKm,
    Math.sqrt(Math.max(widthKm * heightKm, 1e-6) / MAX_CELLS)
  );
  const nx = Math.max(3, Math.ceil(widthKm / cellKm) + 1);
  const ny = Math.max(3, Math.ceil(heightKm / cellKm) + 1);
  const g: Grid = {
    minLon,
    minLat,
    nx,
    ny,
    dlon: (maxLon - minLon) / (nx - 1),
    dlat: (maxLat - minLat) / (ny - 1),
    cellKm,
    elev: new Float64Array(nx * ny),
  };
  if (elevationValues && elevationValues.length !== g.elev.length) {
    throw new Error("DEM sample grid does not match the route-planning grid");
  }
  if (elevationValues) g.elev.set(elevationValues);
  return g;
}

export function getPlanningGridCoordinates(
  start: LonLat,
  goal: LonLat,
  bounds?: PlanningBounds
): LonLat[] {
  const grid = buildGrid(start, goal, undefined, bounds);
  return Array.from({ length: grid.nx * grid.ny }, (_, index) =>
    coordOf(grid, index % grid.nx, Math.floor(index / grid.nx))
  );
}

export function getPlanningBounds(
  start: LonLat,
  goal: LonLat,
  coverage: PlanningBounds
): PlanningBounds {
  const isInside = (point: LonLat) =>
    point[0] >= coverage.west &&
    point[0] <= coverage.east &&
    point[1] >= coverage.south &&
    point[1] <= coverage.north;
  if (!isInside(start) || !isInside(goal)) {
    throw new Error(
      "Start and destination must both be inside the selected DEM coverage."
    );
  }

  const padLon = Math.min(
    Math.max(0.01, Math.abs(goal[0] - start[0]) * 0.25),
    (coverage.east - coverage.west) / 4
  );
  const padLat = Math.min(
    Math.max(0.01, Math.abs(goal[1] - start[1]) * 0.25),
    (coverage.north - coverage.south) / 4
  );
  return {
    west: Math.max(coverage.west, Math.min(start[0], goal[0]) - padLon),
    south: Math.max(coverage.south, Math.min(start[1], goal[1]) - padLat),
    east: Math.min(coverage.east, Math.max(start[0], goal[0]) + padLon),
    north: Math.min(coverage.north, Math.max(start[1], goal[1]) + padLat),
  };
}

// ---------------------------------------------------------------------------
// Priority queue (min-heap on priority, ties broken by insertion order)
// ---------------------------------------------------------------------------
class MinHeap {
  private p: number[] = [];
  private c: number[] = [];
  private n: number[] = [];
  get size() {
    return this.p.length;
  }
  private less(a: number, b: number) {
    return (
      this.p[a] < this.p[b] ||
      (this.p[a] === this.p[b] && this.c[a] < this.c[b])
    );
  }
  private swap(a: number, b: number) {
    [this.p[a], this.p[b]] = [this.p[b], this.p[a]];
    [this.c[a], this.c[b]] = [this.c[b], this.c[a]];
    [this.n[a], this.n[b]] = [this.n[b], this.n[a]];
  }
  push(priority: number, order: number, node: number) {
    this.p.push(priority);
    this.c.push(order);
    this.n.push(node);
    let i = this.p.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.n[0];
    const lp = this.p.pop()!,
      lc = this.c.pop()!,
      ln = this.n.pop()!;
    if (this.p.length > 0) {
      this.p[0] = lp;
      this.c[0] = lc;
      this.n[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < this.p.length && this.less(l, m)) m = l;
        if (r < this.p.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// The three algorithms
// ---------------------------------------------------------------------------
const NEIGHBORS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

interface SearchOut {
  cells: number[] | null;
  expanded: number;
}

// Neighbours of a cell that are inside the grid and not too steep.
// Calls visit(neighbourIndex, distanceKm, slopeDeg).
function forEachNeighbor(
  g: Grid,
  cur: number,
  maxSlope: number,
  visit: (nb: number, distKm: number, slope: number) => void
) {
  const ci = cur % g.nx;
  const cj = Math.floor(cur / g.nx);
  const cLL = coordOf(g, ci, cj);
  for (const [di, dj] of NEIGHBORS) {
    const ni = ci + di,
      nj = cj + dj;
    if (ni < 0 || ni >= g.nx || nj < 0 || nj >= g.ny) continue;
    const nb = nj * g.nx + ni;
    const dist = haversineKm(cLL, coordOf(g, ni, nj));
    const slope = slopeDeg(g.elev[nb] - g.elev[cur], dist);
    if (slope > maxSlope) continue; // impassable
    visit(nb, dist, slope);
  }
}

const edgeCost = (dist: number, slope: number, scale: number) =>
  dist * (1 + (slope / scale) ** 2);

function buildPath(came: Int32Array, goal: number): number[] {
  const cells: number[] = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(k);
  return cells.reverse();
}

// Greedy best-first: expand the node that looks closest to the goal; path cost is ignored.
function greedyBestFirst(
  g: Grid,
  start: number,
  goal: number,
  cfg: AlgoConfig
): SearchOut {
  const goalLL = coordOf(g, goal % g.nx, Math.floor(goal / g.nx));
  const h = (n: number) =>
    haversineKm(coordOf(g, n % g.nx, Math.floor(n / g.nx)), goalLL);
  const came = new Int32Array(g.nx * g.ny).fill(-1);
  const seen = new Uint8Array(g.nx * g.ny);
  const closed = new Uint8Array(g.nx * g.ny);
  const open = new MinHeap();
  let order = 0,
    expanded = 0;
  seen[start] = 1;
  open.push(h(start), order, start);
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goal) return { cells: buildPath(came, cur), expanded };
    // eslint-disable-next-line no-loop-func -- forEachNeighbor invokes the visitor synchronously.
    forEachNeighbor(g, cur, cfg.maxSlope, (nb) => {
      if (seen[nb]) return;
      seen[nb] = 1;
      came[nb] = cur;
      open.push(h(nb), ++order, nb); // priority = h(n) only
    });
  }
  return { cells: null, expanded };
}

// Uniform-cost search: always expand the cheapest known node (priority = g(n)).
function uniformCostSearch(
  g: Grid,
  start: number,
  goal: number,
  cfg: AlgoConfig
): SearchOut {
  const gScore = new Float64Array(g.nx * g.ny).fill(Infinity);
  const came = new Int32Array(g.nx * g.ny).fill(-1);
  const closed = new Uint8Array(g.nx * g.ny);
  const open = new MinHeap();
  let order = 0,
    expanded = 0;
  gScore[start] = 0;
  open.push(0, order, start);
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goal) return { cells: buildPath(came, cur), expanded };
    // eslint-disable-next-line no-loop-func -- forEachNeighbor invokes the visitor synchronously.
    forEachNeighbor(g, cur, cfg.maxSlope, (nb, dist, slope) => {
      if (closed[nb]) return;
      const ng = gScore[cur] + edgeCost(dist, slope, cfg.slopeScale);
      if (ng < gScore[nb]) {
        gScore[nb] = ng;
        came[nb] = cur;
        open.push(ng, ++order, nb); // priority = g(n)
      }
    });
  }
  return { cells: null, expanded };
}

// A*: priority = g(n) + h(n), h = straight-line distance (admissible: cost factor >= 1).
function aStar(
  g: Grid,
  start: number,
  goal: number,
  cfg: AlgoConfig
): SearchOut {
  const goalLL = coordOf(g, goal % g.nx, Math.floor(goal / g.nx));
  const h = (n: number) =>
    haversineKm(coordOf(g, n % g.nx, Math.floor(n / g.nx)), goalLL);
  const gScore = new Float64Array(g.nx * g.ny).fill(Infinity);
  const came = new Int32Array(g.nx * g.ny).fill(-1);
  const closed = new Uint8Array(g.nx * g.ny);
  const open = new MinHeap();
  let order = 0,
    expanded = 0;
  gScore[start] = 0;
  open.push(h(start), order, start);
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goal) return { cells: buildPath(came, cur), expanded };
    // eslint-disable-next-line no-loop-func -- forEachNeighbor invokes the visitor synchronously.
    forEachNeighbor(g, cur, cfg.maxSlope, (nb, dist, slope) => {
      if (closed[nb]) return;
      const ng = gScore[cur] + edgeCost(dist, slope, cfg.slopeScale);
      if (ng < gScore[nb]) {
        gScore[nb] = ng;
        came[nb] = cur;
        open.push(ng + h(nb), ++order, nb); // priority = g(n) + h(n)
      }
    });
  }
  return { cells: null, expanded };
}

const RUN: Record<
  AlgoId,
  (g: Grid, s: number, t: number, c: AlgoConfig) => SearchOut
> = {
  astar: aStar,
  ucs: uniformCostSearch,
  greedy: greedyBestFirst,
};

// ---------------------------------------------------------------------------
// Path post-processing + metrics
// ---------------------------------------------------------------------------
// Chaikin corner cutting: rounds the grid staircase into a smooth, winding curve
// (endpoints are kept) without straightening the path through obstacles.
function chaikin(pts: LonLat[], iterations = 2): LonLat[] {
  let cur = pts;
  for (let it = 0; it < iterations && cur.length > 2; it++) {
    const out: LonLat[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const [ax, ay] = cur[i];
      const [bx, by] = cur[i + 1];
      out.push(
        [0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by],
        [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]
      );
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

function metrics(
  path: LonLat[],
  stepKm: number,
  elevationAt?: (point: LonLat) => number
) {
  let length = 0,
    hours = 0,
    sum = 0,
    count = 0,
    maxS = 0;
  for (let q = 0; q < path.length - 1; q++) {
    const a = path[q],
      b = path[q + 1];
    const n = Math.max(1, Math.ceil(haversineKm(a, b) / stepKm));
    let prev: LonLat = a;
    let prevZ = elevationAt?.(a) ?? 0;
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const p: LonLat = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const z = elevationAt?.(p) ?? 0;
      const d = haversineKm(prev, p);
      const s = elevationAt ? slopeDeg(z - prevZ, d) : 0;
      length += d;
      hours += d / (ROVER_MAX_SPEED_KMH * Math.max(0.15, 1 - (s / 20) ** 1.5));
      sum += s;
      count++;
      maxS = Math.max(maxS, s);
      prev = p;
      prevZ = z;
    }
  }
  const mean = count ? sum / count : 0;
  const risk = Math.min(
    100,
    60 * Math.min(1, mean / 12) + 40 * Math.min(1, maxS / 25)
  );
  const result: Pick<RouteResult, "length_km" | "estimated_time_hours"> &
    Partial<
      Pick<RouteResult, "max_slope_deg" | "avg_slope_deg" | "risk_score">
    > = {
    length_km: round(length, 2),
    estimated_time_hours: round(hours, 1),
  };
  if (elevationAt) {
    result.max_slope_deg = round(maxS, 1);
    result.avg_slope_deg = round(mean, 1);
    result.risk_score = round(risk, 0);
  }
  return result;
}

export function planRoutesLocal(
  start: LonLat,
  end: LonLat,
  elevationValues?: Float64Array,
  terrainLabel = "Configured Mars DEM",
  bounds?: PlanningBounds
): RoutePlanResponse {
  if (haversineKm(start, end) < 1e-6)
    throw new Error("Start and destination are the same point");
  const g = buildGrid(start, end, elevationValues, bounds);
  const sampleGridElevation = elevationValues
    ? (point: LonLat) => {
        const index = cellOf(g, point);
        return g.elev[index];
      }
    : undefined;
  const s = cellOf(g, start);
  const t = cellOf(g, end);
  const routes: RouteResult[] = [];

  for (const id of ALGO_ORDER) {
    const base = ALGORITHMS[id];
    let cfg = base;
    let relaxed = false;
    let out = RUN[id](g, s, t, cfg);
    if (!out.cells) {
      // No path under the slope limit: retry with a 50% looser limit and say so.
      relaxed = true;
      cfg = { ...base, maxSlope: base.maxSlope * 1.5 };
      out = RUN[id](g, s, t, cfg);
    }
    const head = elevationValues
      ? {
          id,
          name: base.name,
          tagline: base.tagline,
          description: base.description,
          color: base.color,
        }
      : {
          id,
          name: base.name,
          tagline:
            id === "astar"
              ? "Balanced search"
              : id === "ucs"
              ? "Lowest-cost search"
              : "Goal-directed search",
          description:
            "No DEM is configured; this route uses geographic distance only.",
          color: base.color,
        };
    if (!out.cells) {
      routes.push({
        ...head,
        error: "No traversable path found",
        nodes_expanded: out.expanded,
      });
      continue;
    }
    const grid = out.cells.map((c) =>
      coordOf(g, c % g.nx, Math.floor(c / g.nx))
    );
    const pts = chaikin([start, ...grid.slice(1, -1), end], 2);
    routes.push({
      ...head,
      path: pts.map(([lo, la]) => [round(lo, 5), round(la, 5)] as LonLat),
      nodes_expanded: out.expanded,
      slope_limit_deg: round(cfg.maxSlope, 1),
      relaxed_constraints: relaxed,
      ...metrics(pts, g.cellKm, sampleGridElevation),
    });
  }
  return {
    routes,
    grid: { cols: g.nx, rows: g.ny, cell_km: round(g.cellKm, 2) },
    terrain: elevationValues ? terrainLabel : "No DEM configured",
  };
}
