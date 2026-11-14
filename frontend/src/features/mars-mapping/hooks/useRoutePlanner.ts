// State for the TAREEQ mission planner: start / end points, the 3 algorithm routes, selection.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlgoId, LonLat, RoutePlanResponse, planRoutes } from '../services/routePlanner';

export type RoutePickMode = 'idle' | 'pickStart' | 'pickEnd';

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

export function useRoutePlanner() {
  const [pickMode, setPickMode] = useState<RoutePickMode>('idle');
  const [start, setStart] = useState<LonLat | null>(null);
  const [end, setEnd] = useState<LonLat | null>(null);
  const [result, setResult] = useState<RoutePlanResponse | null>(null);
  const [activeRoute, setActiveRoute] = useState<AlgoId | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;
  const endRef = useRef(end);
  endRef.current = end;
  const reqId = useRef(0);

  // Called by the map click handler while a pick mode is active.
  const pickPoint = useCallback((lon: number, lat: number) => {
    const p: LonLat = [r5(lon), r5(lat)];
    if (pickModeRef.current === 'pickStart') {
      setStart(p);
      setPickMode(endRef.current ? 'idle' : 'pickEnd');
    } else if (pickModeRef.current === 'pickEnd') {
      setEnd(p);
      setPickMode('idle');
    }
  }, []);

  const setStartPoint = useCallback((p: LonLat | null) => {
    setStart(p);
    if (p) setPickMode(endRef.current ? 'idle' : 'pickEnd');
  }, []);

  const setEndPoint = useCallback((p: LonLat | null) => {
    setEnd(p);
    if (p) setPickMode('idle');
  }, []);

  const swap = useCallback(() => {
    setStart(end);
    setEnd(start);
  }, [start, end]);

  const clear = useCallback(() => {
    reqId.current++;
    setStart(null);
    setEnd(null);
    setResult(null);
    setActiveRoute(null);
    setError(null);
    setLoading(false);
    setPickMode('idle');
  }, []);

  // Plan automatically whenever start/end change.
  useEffect(() => {
    if (!start || !end) {
      setResult(null);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    planRoutes(start, end)
      .then(r => {
        if (id !== reqId.current) return;
        setResult(r);
        setActiveRoute(prev => (prev && r.routes.some(x => x.id === prev && x.path) ? prev : r.routes.find(x => x.path)?.id ?? null));
      })
      .catch(e => {
        if (id !== reqId.current) return;
        setResult(null);
        setError(e instanceof Error ? e.message : 'Route planning failed');
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [start, end]);

  return {
    pickMode, setPickMode, pickPoint,
    start, end, setStartPoint, setEndPoint, swap,
    result, activeRoute, setActiveRoute,
    loading, error, clear,
  };
}

export type RoutePlannerState = ReturnType<typeof useRoutePlanner>;
