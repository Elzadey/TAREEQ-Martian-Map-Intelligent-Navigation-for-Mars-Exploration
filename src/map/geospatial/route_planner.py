"""TAREEQ route planner: Mars-scale A* / Dijkstra with three route profiles.

Profiles
--------
shortest : minimise distance (tolerates steep slopes up to 25 deg)
fastest  : minimise travel time (rover slows down on slopes, max 20 deg)
safest   : minimise risk (strong slope penalty, max 12 deg)

Terrain
-------
There is no real DEM wired into the backend yet, so ``synthetic_elevation``
provides a deterministic stand-in (sinusoidal relief + hashed craters). It is
a pure function of (lon, lat) so the frontend fallback can reproduce it
exactly. To use real MOLA data, pass your own ``elevation_fn(lon, lat) -> m``
to ``plan_routes``.
"""

import heapq
import math
from typing import Callable, Dict, List, Optional, Sequence, Tuple

MARS_RADIUS_KM = 3396.19
KM_PER_DEG = MARS_RADIUS_KM * math.pi / 180.0  # ~59.27 km
ROVER_MAX_SPEED_KMH = 0.15  # Perseverance-class top speed
MAX_CELLS = 22500
MIN_CELL_KM = 0.5
CRATER_CELL_DEG = 3.0

LonLat = Tuple[float, float]
ElevationFn = Callable[[float, float], float]

PROFILES: Dict[str, Dict] = {
    "shortest": {"label": "Shortest", "color": "#22c55e", "max_slope": 25.0},
    "safest": {"label": "Safest", "color": "#eab308", "max_slope": 12.0},
    "fastest": {"label": "Fastest", "color": "#3b82f6", "max_slope": 20.0},
}


# --------------------------------------------------------------------------
# Terrain
# --------------------------------------------------------------------------
def _rand(ix: int, iy: int, k: int) -> float:
    s = math.sin(ix * 127.1 + iy * 311.7 + k * 74.7) * 43758.5453
    return s - math.floor(s)


def synthetic_elevation(lon: float, lat: float) -> float:
    """Deterministic placeholder elevation in metres."""
    z = (
        1800.0 * math.sin(lon * 0.071) * math.cos(lat * 0.083)
        + 700.0 * math.sin(lon * 0.31 + 1.3) * math.sin(lat * 0.27)
        + 280.0 * math.sin(lon * 1.9 + lat * 1.1)
        + 150.0 * math.cos(lon * 3.7 - lat * 2.3)
        + 550.0 * math.sin(lon * 7.3 + lat * 3.1) * math.sin(lat * 6.1 - lon * 2.7)
    )
    cx, cy = math.floor(lon / CRATER_CELL_DEG), math.floor(lat / CRATER_CELL_DEG)
    cos_lat = max(0.2, math.cos(math.radians(lat)))
    for ix in range(cx - 1, cx + 2):
        for iy in range(cy - 1, cy + 2):
            if _rand(ix, iy, 0) > 0.55:
                continue
            ccx = (ix + _rand(ix, iy, 1)) * CRATER_CELL_DEG
            ccy = (iy + _rand(ix, iy, 2)) * CRATER_CELL_DEG
            r_km = 12.0 + _rand(ix, iy, 3) * 38.0
            depth = 2500.0 + _rand(ix, iy, 4) * 3500.0
            dx = (lon - ccx) * cos_lat * KM_PER_DEG
            dy = (lat - ccy) * KM_PER_DEG
            d = math.hypot(dx, dy)
            if d < r_km:
                z -= depth * (1.0 - (d / r_km) ** 2)
            w = 0.10 * r_km
            z += 0.4 * depth * math.exp(-(((d - r_km) / w) ** 2))
    return z


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------
def haversine_km(a: LonLat, b: LonLat) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * MARS_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def _slope_deg(dz_m: float, dist_km: float) -> float:
    if dist_km <= 0:
        return 0.0
    return math.degrees(math.atan(abs(dz_m) / (dist_km * 1000.0)))


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# --------------------------------------------------------------------------
# Grid
# --------------------------------------------------------------------------
class _Grid:
    def __init__(self, start: LonLat, goal: LonLat, elevation_fn: ElevationFn):
        span_lon = abs(goal[0] - start[0])
        span_lat = abs(goal[1] - start[1])
        pad_lon = max(1.0, 0.35 * span_lon)
        pad_lat = max(1.0, 0.35 * span_lat)
        self.min_lon = _clamp(min(start[0], goal[0]) - pad_lon, -180.0, 180.0)
        self.max_lon = _clamp(max(start[0], goal[0]) + pad_lon, -180.0, 180.0)
        self.min_lat = _clamp(min(start[1], goal[1]) - pad_lat, -85.0, 85.0)
        self.max_lat = _clamp(max(start[1], goal[1]) + pad_lat, -85.0, 85.0)

        mid_lat = (self.min_lat + self.max_lat) / 2
        cos_mid = max(0.2, math.cos(math.radians(mid_lat)))
        width_km = (self.max_lon - self.min_lon) * cos_mid * KM_PER_DEG
        height_km = (self.max_lat - self.min_lat) * KM_PER_DEG
        self.cell_km = max(
            MIN_CELL_KM, math.sqrt(max(width_km * height_km, 1e-6) / MAX_CELLS)
        )
        self.nx = max(3, int(math.ceil(width_km / self.cell_km)) + 1)
        self.ny = max(3, int(math.ceil(height_km / self.cell_km)) + 1)
        self.dlon = (self.max_lon - self.min_lon) / (self.nx - 1)
        self.dlat = (self.max_lat - self.min_lat) / (self.ny - 1)

        self.elev: List[float] = [0.0] * (self.nx * self.ny)
        for j in range(self.ny):
            for i in range(self.nx):
                lon, lat = self.coord(i, j)
                self.elev[j * self.nx + i] = elevation_fn(lon, lat)

    def coord(self, i: int, j: int) -> LonLat:
        return (self.min_lon + i * self.dlon, self.min_lat + j * self.dlat)

    def cell(self, p: LonLat) -> Tuple[int, int]:
        i = int(round((p[0] - self.min_lon) / self.dlon))
        j = int(round((p[1] - self.min_lat) / self.dlat))
        return (int(_clamp(i, 0, self.nx - 1)), int(_clamp(j, 0, self.ny - 1)))

    def z(self, i: int, j: int) -> float:
        return self.elev[j * self.nx + i]


_NEIGHBORS = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]


# --------------------------------------------------------------------------
# Cost model
# --------------------------------------------------------------------------
def _edge_cost(profile: str, dist_km: float, slope: float, max_slope: float) -> float:
    if profile == "shortest":
        return dist_km
    if profile == "fastest":
        speed = ROVER_MAX_SPEED_KMH * max(0.15, 1.0 - (slope / max_slope) ** 1.5)
        return dist_km / speed
    # safest
    return dist_km * (1.0 + (slope / 4.0) ** 2)


def _heuristic_scale(profile: str) -> float:
    # Lower bound of cost per km, keeps A* admissible.
    return 1.0 / ROVER_MAX_SPEED_KMH if profile == "fastest" else 1.0


def _search(
    grid: _Grid,
    start: Tuple[int, int],
    goal: Tuple[int, int],
    profile: str,
    max_slope: float,
    algorithm: str,
) -> Tuple[Optional[List[Tuple[int, int]]], int]:
    goal_ll = grid.coord(*goal)
    use_h = algorithm == "astar"
    h_scale = _heuristic_scale(profile)

    def h(node: Tuple[int, int]) -> float:
        if not use_h:
            return 0.0
        return haversine_km(grid.coord(*node), goal_ll) * h_scale

    g: Dict[Tuple[int, int], float] = {start: 0.0}
    came: Dict[Tuple[int, int], Tuple[int, int]] = {}
    heap: List[Tuple[float, int, Tuple[int, int]]] = [(h(start), 0, start)]
    closed = set()
    counter = 0
    expanded = 0

    while heap:
        _, _, cur = heapq.heappop(heap)
        if cur in closed:
            continue
        closed.add(cur)
        expanded += 1
        if cur == goal:
            path = [cur]
            while cur in came:
                cur = came[cur]
                path.append(cur)
            return path[::-1], expanded

        ci, cj = cur
        c_ll = grid.coord(ci, cj)
        c_z = grid.z(ci, cj)
        for di, dj in _NEIGHBORS:
            ni, nj = ci + di, cj + dj
            if not (0 <= ni < grid.nx and 0 <= nj < grid.ny):
                continue
            nb = (ni, nj)
            if nb in closed:
                continue
            n_ll = grid.coord(ni, nj)
            dist = haversine_km(c_ll, n_ll)
            slope = _slope_deg(grid.z(ni, nj) - c_z, dist)
            if slope > max_slope:
                continue
            ng = g[cur] + _edge_cost(profile, dist, slope, max_slope)
            if ng < g.get(nb, float("inf")):
                g[nb] = ng
                came[nb] = cur
                counter += 1
                heapq.heappush(heap, (ng + h(nb), counter, nb))
    return None, expanded


# --------------------------------------------------------------------------
# Path post-processing and metrics
# --------------------------------------------------------------------------
def _polyline_cost(
    pts: List[LonLat],
    profile: str,
    max_slope: float,
    elevation_fn: ElevationFn,
    step_km: float,
) -> float:
    """Profile cost of a polyline, sampled every ``step_km``. inf if too steep."""
    total = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = haversine_km(a, b)
        n = max(1, int(math.ceil(seg / step_km)))
        prev, prev_z = a, elevation_fn(*a)
        for k in range(1, n + 1):
            t = k / n
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            z = elevation_fn(*p)
            d = haversine_km(prev, p)
            s = _slope_deg(z - prev_z, d)
            if s > max_slope:
                return float("inf")
            total += _edge_cost(profile, d, s, max_slope)
            prev, prev_z = p, z
    return total


_SMOOTH_WINDOW = 50
_BIG = 1e18


def _smooth(
    path: List[LonLat],
    profile: str,
    max_slope: float,
    elevation_fn: ElevationFn,
    step_km: float,
) -> List[LonLat]:
    """Shortcut the grid path, keeping a shortcut only if it is finite and not
    costlier (for this profile) than the grid sub-path it replaces."""
    if len(path) <= 2:
        return path
    seg_cost = []
    for a, b in zip(path, path[1:]):
        c = _polyline_cost([a, b], profile, max_slope, elevation_fn, step_km)
        seg_cost.append(_BIG if c == float("inf") else c)
    cum = [0.0]
    for c in seg_cost:
        cum.append(cum[-1] + c)

    out = [path[0]]
    i = 0
    last = len(path) - 1
    while i < last:
        j = min(last, i + _SMOOTH_WINDOW)
        while j > i + 1:
            direct = _polyline_cost(
                [path[i], path[j]], profile, max_slope, elevation_fn, step_km
            )
            if direct < float("inf") and direct <= (cum[j] - cum[i]) * 1.001:
                break
            j -= 1
        out.append(path[j])
        i = j
    return out


def _metrics(
    path: List[LonLat],
    profile: str,
    max_slope: float,
    elevation_fn: ElevationFn,
    step_km: float,
) -> Dict:
    length = 0.0
    hours = 0.0
    slopes: List[float] = []
    for a, b in zip(path, path[1:]):
        seg = haversine_km(a, b)
        n = max(1, int(math.ceil(seg / step_km)))
        prev, prev_z = a, elevation_fn(*a)
        for k in range(1, n + 1):
            t = k / n
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            z = elevation_fn(*p)
            d = haversine_km(prev, p)
            s = _slope_deg(z - prev_z, d)
            slopes.append(s)
            length += d
            speed = ROVER_MAX_SPEED_KMH * max(0.15, 1.0 - (s / 20.0) ** 1.5)
            hours += d / speed
            prev, prev_z = p, z
    max_s = max(slopes) if slopes else 0.0
    mean_s = sum(slopes) / len(slopes) if slopes else 0.0
    risk = min(100.0, 60.0 * min(1.0, mean_s / 12.0) + 40.0 * min(1.0, max_s / 25.0))
    return {
        "length_km": round(length, 2),
        "estimated_time_hours": round(hours, 1),
        "estimated_time_sols": round(hours / 24.66, 1),
        "max_slope_deg": round(max_s, 1),
        "avg_slope_deg": round(mean_s, 1),
        "risk_score": round(risk, 0),
    }


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
def plan_routes(
    start: LonLat,
    end: LonLat,
    profiles: Optional[Sequence[str]] = None,
    algorithm: str = "astar",
    elevation_fn: Optional[ElevationFn] = None,
) -> Dict:
    """Plan one route per requested profile.

    ``start`` / ``end`` are (lon, lat) in degrees. Returns a dict with
    ``routes`` (list, one per profile) and ``grid`` info. Routes that cannot
    be found carry an ``error`` field instead of a path.
    """
    if algorithm not in ("astar", "dijkstra"):
        raise ValueError("algorithm must be 'astar' or 'dijkstra'")
    names = list(profiles) if profiles else ["shortest", "safest", "fastest"]
    for n in names:
        if n not in PROFILES:
            raise ValueError(f"unknown profile: {n}")
    if haversine_km(start, end) < 1e-6:
        raise ValueError("start and end are the same point")

    elev = elevation_fn or synthetic_elevation
    grid = _Grid(start, end, elev)
    s_cell, g_cell = grid.cell(start), grid.cell(end)
    step_km = grid.cell_km

    routes = []
    for name in names:
        cfg = PROFILES[name]
        max_slope = cfg["max_slope"]
        relaxed = False
        cells, expanded = _search(grid, s_cell, g_cell, name, max_slope, algorithm)
        if cells is None:
            relaxed = True
            max_slope = cfg["max_slope"] * 1.5
            cells, expanded = _search(grid, s_cell, g_cell, name, max_slope, algorithm)
        base = {
            "profile": name,
            "label": cfg["label"],
            "color": cfg["color"],
            "algorithm": "A*" if algorithm == "astar" else "Dijkstra",
        }
        if cells is None:
            routes.append({**base, "error": "No traversable path found"})
            continue
        pts = [start] + [grid.coord(i, j) for i, j in cells[1:-1]] + [end]
        pts = _smooth(pts, name, max_slope, elev, step_km)
        routes.append(
            {
                **base,
                "path": [[round(p[0], 5), round(p[1], 5)] for p in pts],
                "nodes_expanded": expanded,
                "slope_limit_deg": round(max_slope, 1),
                "relaxed_constraints": relaxed,
                **_metrics(pts, name, max_slope, elev, step_km),
            }
        )

    return {
        "routes": routes,
        "grid": {
            "cols": grid.nx,
            "rows": grid.ny,
            "cell_km": round(grid.cell_km, 2),
        },
        "terrain": "synthetic" if elevation_fn is None else "custom",
    }
