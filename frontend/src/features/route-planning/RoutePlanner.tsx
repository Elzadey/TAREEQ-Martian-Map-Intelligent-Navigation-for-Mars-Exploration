// TAREEQ "Start Mission" on the 2D OpenLayers map.
//   Start Mission -> side panel -> pick start / destination -> three routes (A*, UCS, Greedy)
//   -> select one -> "Start driving": the rover moves step by step and the dashed line to the
//   destination is re-rasterised (Bresenham) in screen pixels at every step.
import { Feature } from 'ol';
import type { Map as OLMap } from 'ol';
import { Point } from 'ol/geom';
import { Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRoutePlanner } from '../mars-mapping/hooks/useRoutePlanner';
import { AlgoId, LonLat, RouteResult, haversineKm } from './algorithms';
import { Pixel, dashPixels, rasterisePolyline } from './bresenham';
import DirectionsPanel, { DriveControls, formatDistance, formatDuration } from './DirectionsPanel';
import { consumeMissionStart, onMissionStart } from './missionBus';
import { publishActiveRoute, publishMissionRouteState } from './routeOverlayBus';

interface Props {
  map: OLMap | null;
}

type DriveState = DriveControls['state'];

const DRIVE_SECONDS = 15; // whole route, regardless of length
const LABEL_FRACTIONS: Record<AlgoId, number> = { astar: 0.5, ucs: 0.35, greedy: 0.65 };

interface Geometry {
  cum: number[]; // cumulative km at each vertex
  total: number;
}

const buildGeometry = (path: LonLat[]): Geometry => {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversineKm(path[i - 1], path[i]));
  return { cum, total: cum[cum.length - 1] };
};

// Point at a fraction of the route; idx = index of the first vertex AFTER the point.
const positionAt = (path: LonLat[], g: Geometry, frac: number): { pos: LonLat; idx: number } => {
  const target = g.total * Math.min(Math.max(frac, 0), 1);
  let i = 1;
  while (i < path.length - 1 && g.cum[i] < target) i++;
  const span = g.cum[i] - g.cum[i - 1] || 1;
  const t = (target - g.cum[i - 1]) / span;
  const a = path[i - 1];
  const b = path[i];
  return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], idx: i };
};

const paintPixels = (ctx: CanvasRenderingContext2D, pixels: Pixel[], size: number, color: string, halo: boolean) => {
  if (halo) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const h = size + 2;
    for (const [x, y] of pixels) ctx.fillRect(x - h / 2, y - h / 2, h, h);
  }
  ctx.fillStyle = color;
  for (const [x, y] of pixels) ctx.fillRect(x - size / 2, y - size / 2, size, size);
};

const RoutePlanner: React.FC<Props> = ({ map }) => {
  const route = useRoutePlanner();
  const [active, setActive] = useState(false);
  const [driveState, setDriveState] = useState<DriveState>('idle');
  const [progress, setProgress] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;
  const routesRef = useRef<RouteResult[]>([]);
  routesRef.current = route.result?.routes ?? [];
  const activeIdRef = useRef<AlgoId | null>(route.activeRoute);
  activeIdRef.current = route.activeRoute;
  const geomRef = useRef<Partial<Record<AlgoId, Geometry>>>({});
  const progressRef = useRef(0);
  const driveStateRef = useRef<DriveState>('idle');
  driveStateRef.current = driveState;

  const pickModeRef = useRef(route.pickMode);
  pickModeRef.current = route.pickMode;
  const pickPointRef = useRef(route.pickPoint);
  pickPointRef.current = route.pickPoint;
  const setActiveRouteRef = useRef(route.setActiveRoute);
  setActiveRouteRef.current = route.setActiveRoute;
  const { setPickMode, clear } = route;

  useEffect(() => {
    const active = route.result?.routes.find(
      (candidate) => candidate.id === route.activeRoute && candidate.path,
    ) ?? route.result?.routes.find((candidate) => candidate.path) ?? null;

    if (!active || !active.path) {
      publishActiveRoute(null);
      publishMissionRouteState(null);
      return;
    }

    const selectedPath = active.path;
    const selectedStart = route.start ?? selectedPath[0] ?? null;
    const selectedEnd = route.end ?? selectedPath[selectedPath.length - 1] ?? null;
    const totalDistanceKm = active.length_km ?? selectedPath.reduce((sum, point, index) => {
      if (index === 0) return sum;
      return sum + haversineKm(selectedPath[index - 1], point);
    }, 0);

    publishActiveRoute({ path: selectedPath, color: active.color });
    publishMissionRouteState({
      path: selectedPath,
      color: active.color,
      name: active.name,
      algorithm: active.name,
      algorithmId: active.id,
      start: selectedStart,
      end: selectedEnd,
      distanceKm: totalDistanceKm,
      durationHours: active.estimated_time_hours ?? null,
      terrainSource: route.result?.terrain ?? 'No DEM configured',
      maxSlopeDeg: active.max_slope_deg,
      averageSlopeDeg: active.avg_slope_deg,
      riskScore: active.risk_score,
    });
  }, [route.activeRoute, route.result, route.start, route.end]);

  // ---- canvas drawing: every dashed line is rasterised with Bresenham in screen pixels ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const m = mapRef.current;
    if (!canvas || !m) return;
    const size = m.getSize();
    if (!size) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size[0] * dpr) || canvas.height !== Math.round(size[1] * dpr)) {
      canvas.width = Math.round(size[0] * dpr);
      canvas.height = Math.round(size[1] * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size[0], size[1]);

    const toPixels = (pts: LonLat[]): Pixel[] => {
      const out: Pixel[] = [];
      for (const p of pts) {
        const px = m.getPixelFromCoordinate(p);
        if (px) out.push([Math.round(px[0]), Math.round(px[1])]);
      }
      return out;
    };

    const routes = routesRef.current.filter(r => r.path);
    const ordered = [...routes.filter(r => r.id !== activeIdRef.current), ...routes.filter(r => r.id === activeIdRef.current)];
    let rover: Pixel | null = null;

    for (const r of ordered) {
      const path = r.path as LonLat[];
      const isActive = r.id === activeIdRef.current;
      let remaining = path;
      let travelled: LonLat[] = [];
      if (isActive && progressRef.current > 0) {
        const g = geomRef.current[r.id];
        if (g) {
          const { pos, idx } = positionAt(path, g, progressRef.current);
          travelled = [...path.slice(0, idx), pos];
          remaining = [pos, ...path.slice(idx)];
          const rp = toPixels([pos])[0];
          if (rp) rover = rp;
        }
      }
      if (travelled.length > 1) {
        paintPixels(ctx, rasterisePolyline(toPixels(travelled), size[0], size[1]), 3, 'rgba(255,255,255,0.9)', true);
      }
      const pixels = rasterisePolyline(toPixels(remaining), size[0], size[1]);
      if (isActive) {
        paintPixels(ctx, dashPixels(pixels, 10, 7), 4, r.color, true);
      } else {
        ctx.globalAlpha = 0.65;
        paintPixels(ctx, dashPixels(pixels, 6, 6), 2, r.color, false);
        ctx.globalAlpha = 1;
      }
    }

    if (rover) {
      ctx.beginPath();
      ctx.arc(rover[0], rover[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }, []);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // ---- mission start / end ----
  const resetDrive = useCallback(() => {
    progressRef.current = 0;
    setProgress(0);
    setDriveState('idle');
    drawRef.current();
  }, []);

  const startMission = useCallback(() => {
    clear();
    resetDrive();
    setActive(true);
    setPickMode('pickStart');
  }, [clear, resetDrive, setPickMode]);

  const endMission = useCallback(() => {
    clear();
    resetDrive();
    setActive(false);
  }, [clear, resetDrive]);

  useEffect(() => {
    if (consumeMissionStart()) startMission();
    return onMissionStart(() => {
      if (consumeMissionStart()) startMission();
    });
  }, [startMission]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickMode('idle');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPickMode]);

  // ---- vector layer (markers + time/distance bubbles), click handling, redraw on map render ----
  useEffect(() => {
    if (!map) return;
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 900,
      style: feature => {
        const kind = feature.get('kind');
        const isActive = feature.get('active') as boolean;
        if (kind === 'label') {
          const st = new Style({
            text: new Text({
              text: feature.get('text') as string,
              font: 'bold 12px Arial, sans-serif',
              fill: new Fill({ color: isActive ? '#ffffff' : '#202124' }),
              backgroundFill: new Fill({ color: isActive ? '#2a1fd6' : '#ffffff' }),
              backgroundStroke: new Stroke({ color: isActive ? '#1f1b8f' : '#9aa0a6', width: 1 }),
              padding: [5, 9, 5, 9],
            }),
          });
          st.setZIndex(isActive ? 20 : 10);
          return st;
        }
        if (kind === 'start') {
          return new Style({
            image: new Circle({ radius: 8, fill: new Fill({ color: '#ffffff' }), stroke: new Stroke({ color: '#3c4043', width: 3 }) }),
          });
        }
        return [
          new Style({ image: new Circle({ radius: 11, fill: new Fill({ color: '#d93025' }), stroke: new Stroke({ color: '#ffffff', width: 2 }) }) }),
          new Style({ image: new Circle({ radius: 4, fill: new Fill({ color: '#ffffff' }) }) }),
        ];
      },
    });
    map.addLayer(layer);
    sourceRef.current = source;

    // distance from a pixel to a route polyline (screen space)
    const distToRoute = (px: number[], r: RouteResult): number => {
      let best = Infinity;
      let prev: number[] | null = null;
      for (const p of r.path ?? []) {
        const c = map.getPixelFromCoordinate(p);
        if (!c) continue;
        if (prev) {
          const vx = c[0] - prev[0], vy = c[1] - prev[1];
          const len2 = vx * vx + vy * vy || 1;
          const t = Math.max(0, Math.min(1, ((px[0] - prev[0]) * vx + (px[1] - prev[1]) * vy) / len2));
          best = Math.min(best, Math.hypot(px[0] - (prev[0] + t * vx), px[1] - (prev[1] + t * vy)));
        }
        prev = c;
      }
      return best;
    };

    const onClick = (evt: { coordinate: number[]; pixel: number[] }) => {
      if (pickModeRef.current !== 'idle') {
        pickPointRef.current(evt.coordinate[0], evt.coordinate[1]);
        return;
      }
      // click near a route selects it
      let bestId: AlgoId | null = null;
      let bestD = 12;
      for (const r of routesRef.current) {
        if (!r.path) continue;
        const d = distToRoute(evt.pixel, r);
        if (d < bestD) {
          bestD = d;
          bestId = r.id;
        }
      }
      if (bestId) setActiveRouteRef.current(bestId);
    };
    const onRender = () => drawRef.current();
    map.on('click', onClick as never);
    map.on('postrender', onRender as never);
    drawRef.current();

    return () => {
      map.un('click', onClick as never);
      map.un('postrender', onRender as never);
      map.removeLayer(layer);
      sourceRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const el = map?.getTargetElement();
    if (el) el.style.cursor = route.pickMode === 'idle' ? '' : 'crosshair';
  }, [map, route.pickMode]);

  // ---- markers + bubbles ----
  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.clear();
    (route.result?.routes ?? []).forEach(r => {
      if (!r.path) return;
      const g = geomRef.current[r.id] ?? buildGeometry(r.path);
      const { pos } = positionAt(r.path, g, LABEL_FRACTIONS[r.id]);
      const f = new Feature({ geometry: new Point(pos) });
      f.setProperties({
        kind: 'label',
        active: r.id === route.activeRoute,
        text: `${r.name === 'A*' ? 'A*' : r.name.split(' ')[0]} · ${formatDuration(r.estimated_time_hours)} · ${formatDistance(r.length_km)}`,
      });
      source.addFeature(f);
    });
    if (route.start) source.addFeature(new Feature({ geometry: new Point(route.start), kind: 'start' }));
    if (route.end) source.addFeature(new Feature({ geometry: new Point(route.end), kind: 'end' }));
  }, [map, route.result, route.activeRoute, route.start, route.end]);

  // ---- new plan / different route selected: rebuild geometry, reset the rover, redraw, frame ----
  useEffect(() => {
    const geo: Partial<Record<AlgoId, Geometry>> = {};
    (route.result?.routes ?? []).forEach(r => {
      if (r.path) geo[r.id] = buildGeometry(r.path);
    });
    geomRef.current = geo;
  }, [route.result]);

  useEffect(() => {
    resetDrive();
  }, [route.result, route.activeRoute, resetDrive]);

  useEffect(() => {
    const m = mapRef.current;
    const paths = (route.result?.routes ?? []).filter(r => r.path);
    if (!m || paths.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    paths.forEach(r => r.path!.forEach(([x, y]) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }));
    m.getView().fit([minX, minY, maxX, maxY], { padding: [100, 100, 100, 500], duration: 600, maxZoom: 12 });
  }, [route.result]);

  // ---- rover animation: each frame advances one step and re-rasterises the dashed line ----
  useEffect(() => {
    if (driveState !== 'driving') return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      progressRef.current = Math.min(1, progressRef.current + dt / DRIVE_SECONDS);
      drawRef.current();
      if (now - lastUi > 100 || progressRef.current >= 1) {
        lastUi = now;
        setProgress(progressRef.current);
      }
      if (progressRef.current >= 1) {
        setDriveState('arrived');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [driveState]);

  const drive: DriveControls = {
    state: driveState,
    progress,
    start: () => {
      if (progressRef.current >= 1) progressRef.current = 0;
      setDriveState('driving');
    },
    pause: () => setDriveState('paused'),
    reset: resetDrive,
  };

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 z-20 pointer-events-none" style={{ width: '100%', height: '100%' }} />
      {active && <DirectionsPanel planner={route} drive={drive} onClose={endMission} />}
    </>
  );
};

export default RoutePlanner;
