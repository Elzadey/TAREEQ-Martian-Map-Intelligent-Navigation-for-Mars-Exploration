import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Compass,
  Flag,
  Gauge,
  MapPin,
  Pause,
  Play,
  Rocket,
  StopCircle,
  Target,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import type { LonLat } from '../features/route-planning/algorithms';
import { subscribeToActiveRoute } from '../features/route-planning/routeOverlayBus';

interface SurveyExperienceProps {
  onReturnToGlobe?: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const haversineKm = (a: LonLat, b: LonLat): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s1 = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 3396.19 * Math.asin(Math.min(1, Math.sqrt(s1)));
};

const formatDistance = (km: number) => (km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(1)} km`);

const formatCoordinate = (coord: LonLat) => {
  const [lon, lat] = coord;
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
};

const getPointAlongRoute = (path: LonLat[], progress: number): LonLat => {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  const safeProgress = clamp(progress, 0, 1);
  const target = safeProgress * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(target));
  const nextIndex = Math.min(path.length - 1, index + 1);
  const segmentProgress = target - index;
  const start = path[index];
  const end = path[nextIndex];
  return [
    start[0] + (end[0] - start[0]) * segmentProgress,
    start[1] + (end[1] - start[1]) * segmentProgress,
  ];
};

const SurveyExperience: React.FC<SurveyExperienceProps> = ({ onReturnToGlobe }) => {
  const [route, setRoute] = useState<{ path: LonLat[]; color: string } | null>(null);
  const [progress, setProgress] = useState(0.18);
  const [paused, setPaused] = useState(false);
  const [missionComplete, setMissionComplete] = useState(false);
  const [modeLabel, setModeLabel] = useState('Survey mode');

  const handleMove = React.useCallback((delta: number) => {
    const next = clamp(progress + delta, 0, 1);
    setProgress(next);
    if (next >= 1) setMissionComplete(true);
  }, [progress]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') handleMove(-0.08);
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') handleMove(0.08);
      if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') handleMove(0.04);
      if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') handleMove(-0.04);
      if (event.key === ' ' || event.key.toLowerCase() === 'p') setPaused((current) => !current);
      if (event.key === 'Escape') setMissionComplete(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleMove]);

  useEffect(() => {
    const unsubscribe = subscribeToActiveRoute((nextRoute) => {
      setRoute(nextRoute);
      if (nextRoute && nextRoute.path.length > 1) {
        setProgress(0.18);
        setMissionComplete(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!route || route.path.length < 2 || paused || missionComplete) return;

    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = current + 0.0065;
        if (next >= 1) {
          setMissionComplete(true);
          return 1;
        }
        return next;
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [route, paused, missionComplete]);

  const totalDistance = useMemo(() => {
    if (!route || route.path.length < 2) return 0;
    let distance = 0;
    for (let i = 1; i < route.path.length; i++) {
      distance += haversineKm(route.path[i - 1], route.path[i]);
    }
    return distance;
  }, [route]);

  const roverCoordinates = useMemo(() => {
    if (!route || route.path.length === 0) return [0, 0] as LonLat;
    return getPointAlongRoute(route.path, progress);
  }, [route, progress]);

  const roverPosition = useMemo(() => {
    if (!route || route.path.length === 0) return { x: 220, y: 330 };
    const x = 140 + ((roverCoordinates[0] + 180) / 360) * 740;
    const y = 520 - ((roverCoordinates[1] + 90) / 180) * 420;
    return { x: clamp(x, 80, 920), y: clamp(y, 80, 620) };
  }, [route, roverCoordinates]);

  const start = route?.path[0] ?? [0, 0];
  const destination = route?.path[route.path.length - 1] ?? [0, 0];
  const distanceTravelled = totalDistance * progress;
  const distanceRemaining = Math.max(totalDistance - distanceTravelled, 0);
  const percentComplete = Math.round(progress * 100);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#050b14] text-white">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            'radial-gradient(circle at 20% 20%, rgba(249,115,22,0.22), transparent 25%), radial-gradient(circle at 80% 0%, rgba(56,189,248,0.18), transparent 32%), linear-gradient(135deg, #050b14 0%, #101827 42%, #141a2b 100%)',
        }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(15,23,42,0.2),_transparent_55%)]" />

      {route && route.path.length > 1 && (
        <svg viewBox="0 0 1000 700" className="absolute inset-0 h-full w-full opacity-90">
          <path d="M 120 520 C 250 380, 350 440, 430 360 S 660 260, 820 240" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeDasharray="10 10" />
          {route.path.map((point, index) => {
            const x = 140 + ((point[0] + 180) / 360) * 740;
            const y = 520 - ((point[1] + 90) / 180) * 420;
            const isStart = index === 0;
            const isEnd = index === route.path.length - 1;
            return (
              <g key={`${point[0]}-${point[1]}-${index}`}>
                {isStart && <circle cx={x} cy={y} r="12" fill="#f5f5f5" stroke="#1f2937" strokeWidth="3" />}
                {isEnd && <circle cx={x} cy={y} r="16" fill={route.color} stroke="#fff" strokeWidth="3" />}
              </g>
            );
          })}
          <polyline
            points={route.path
              .map((point) => {
                const x = 140 + ((point[0] + 180) / 360) * 740;
                const y = 520 - ((point[1] + 90) / 180) * 420;
                return `${x},${y}`;
              })
              .join(' ')}
            fill="none"
            stroke={route.color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="18 16"
          />
          <circle cx={roverPosition.x} cy={roverPosition.y} r="18" fill="#f59e0b" stroke="#fff" strokeWidth="4" />
          <line
            x1={roverPosition.x}
            y1={roverPosition.y}
            x2={roverPosition.x + 26}
            y2={roverPosition.y - 26}
            stroke="#f8fafc"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      )}

      <div className="relative z-10 flex h-full flex-col">
        <header className="flex items-center justify-between px-6 py-5 sm:px-8">
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/60 px-4 py-2 backdrop-blur-md">
            <Rocket className="h-4 w-4 text-orange-300" />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-300">Mission</div>
              <div className="text-sm font-semibold text-white">Ares Survey</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-2 backdrop-blur-md">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="text-xs font-medium uppercase tracking-[0.22em] text-orange-100">{missionComplete ? 'Mission complete' : 'In progress'}</span>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-between gap-6 px-6 pb-6 sm:px-8">
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="flex flex-col justify-end">
              <div className="mb-5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.26em] text-sky-200">
                <Compass className="h-4 w-4 text-sky-300" />
                {modeLabel}
              </div>
              <div className="max-w-xl">
                <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Exploration phase</div>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-5xl">SURVEY VIEW / EXPLORE MISSION</h2>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-slate-950/55 p-5 shadow-2xl shadow-black/30 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.24em] text-slate-300">
                <span>Mission progress</span>
                <span>{percentComplete}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-500 via-amber-400 to-orange-300 transition-all duration-300"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-slate-200">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Distance</div>
                  <div className="mt-2 font-semibold text-white">{formatDistance(distanceTravelled)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Remaining</div>
                  <div className="mt-2 font-semibold text-white">{formatDistance(distanceRemaining)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.4fr_0.9fr]">
            <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-4 backdrop-blur-md">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-300">
                <Target className="h-4 w-4 text-orange-300" />
                Objectives
              </div>
              <ul className="space-y-3 text-sm text-slate-200">
                <li className="flex gap-3"><span className="mt-1 h-2 w-2 rounded-full bg-orange-400" />Survey route and terrain</li>
                <li className="flex gap-3"><span className="mt-1 h-2 w-2 rounded-full bg-sky-400" />Inspect waypoints</li>
                <li className="flex gap-3"><span className="mt-1 h-2 w-2 rounded-full bg-violet-400" />Assess geological markers</li>
              </ul>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-slate-950/55 p-4 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300">
                  <Compass className="h-4 w-4 text-sky-300" />
                  Rover telemetry
                </div>
                <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-200">
                  Stable
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Current coords</div>
                  <div className="mt-2 text-sm font-semibold text-white">{route ? formatCoordinate(roverCoordinates) : 'Awaiting route'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Calculated elevation</div>
                  <div className="mt-2 text-sm font-semibold text-white">{route ? `${Math.round((progress * 1800) + 200)} m (simulated)` : '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Simulated slope</div>
                  <div className="mt-2 text-sm font-semibold text-white">{route ? `${Math.round((1 - progress) * 12 + 4)}°` : '—'}</div>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-4 backdrop-blur-md">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-300">
                <Gauge className="h-4 w-4 text-orange-300" />
                Rover controls
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => handleMove(-0.08)} className="rounded-xl border border-white/10 bg-white/5 p-2 text-sm text-white hover:bg-white/10"><ArrowLeft className="mx-auto h-4 w-4" /></button>
                <button type="button" onClick={() => handleMove(0.08)} className="rounded-xl border border-white/10 bg-white/5 p-2 text-sm text-white hover:bg-white/10"><ArrowRight className="mx-auto h-4 w-4" /></button>
                <button type="button" onClick={() => setPaused((value) => !value)} className="rounded-xl border border-white/10 bg-white/5 p-2 text-sm text-white hover:bg-white/10">{paused ? <Play className="mx-auto h-4 w-4" /> : <Pause className="mx-auto h-4 w-4" />}</button>
                <button type="button" onClick={() => { setProgress(0); setMissionComplete(false); }} className="rounded-xl border border-white/10 bg-white/5 p-2 text-sm text-white hover:bg-white/10"><StopCircle className="mx-auto h-4 w-4" /></button>
              </div>
              <button type="button" onClick={() => setModeLabel((value) => (value === 'Survey mode' ? 'Camera orbit' : 'Survey mode'))} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-orange-100 hover:bg-orange-500/20">
                <Camera className="h-4 w-4" />
                Camera orbit
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-5 left-5 z-20 rounded-2xl border border-white/10 bg-slate-950/60 p-3 backdrop-blur-md">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-slate-300">
          <MapPin className="h-3.5 w-3.5 text-orange-300" />
          Starting point
        </div>
        <div className="mt-2 text-sm font-medium text-white">{route ? formatCoordinate(start) : 'Awaiting route'}</div>
      </div>

      <div className="absolute bottom-5 right-5 z-20 rounded-2xl border border-white/10 bg-slate-950/60 p-3 backdrop-blur-md">
        <div className="text-[10px] uppercase tracking-[0.24em] text-slate-300">Destination</div>
        <div className="mt-2 text-sm font-medium text-white">{route ? formatCoordinate(destination) : 'Awaiting route'}</div>
      </div>

      {missionComplete && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#050b14]/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[32px] border border-white/10 bg-slate-950/90 p-8 text-center shadow-2xl shadow-black/40">
            <div className="mb-3 flex justify-center">
              <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 p-3">
                <Flag className="h-8 w-8 text-emerald-300" />
              </div>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Mission status</div>
            <h3 className="mt-3 text-4xl font-black tracking-tight text-white">MISSION COMPLETED</h3>
            <div className="mt-5 space-y-2 text-sm text-slate-200">
              <div>Start: {route ? formatCoordinate(start) : '—'}</div>
              <div>Destination: {route ? formatCoordinate(destination) : '—'}</div>
              <div>Total route distance: {route ? formatDistance(totalDistance) : '—'}</div>
              <div>Completed waypoints: {Math.max(1, Math.round(progress * 6))}</div>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={onReturnToGlobe} className="rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:brightness-110">
                Return to Mars Globe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SurveyExperience;
