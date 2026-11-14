// Google-Maps-style directions side panel for TAREEQ:
// start / destination boxes (type a Mars place name or click the map), swap button,
// and the list of routes to choose from.
import { ArrowDownUp, MapPin, Navigation, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MARS_LOCATIONS } from "../../shared/constants/mars-data";
import type { MarsLocation } from "../../shared/types/mars-types";
import { searchMarsLocations } from "../../shared/utils/mars-utils";
import type { RoutePlannerState } from "../mars-mapping/hooks/useRoutePlanner";
import type { LonLat } from "../mars-mapping/services/routePlanner";

export const formatDuration = (hours?: number): string => {
  if (hours === undefined) return "–";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${(hours / 24.66).toFixed(1)} sols`;
};

export const formatDistance = (km?: number): string =>
  km === undefined
    ? "–"
    : km >= 100
    ? `${Math.round(km).toLocaleString()} km`
    : `${km.toFixed(1)} km`;

const coordText = (p: LonLat) =>
  `${Math.abs(p[1]).toFixed(3)}°${p[1] >= 0 ? "N" : "S"}, ${Math.abs(
    p[0]
  ).toFixed(3)}°${p[0] >= 0 ? "E" : "W"}`;

export interface DriveControls {
  state: "idle" | "driving" | "paused" | "arrived";
  progress: number; // 0..1
  start: () => void;
  pause: () => void;
  reset: () => void;
}

interface Props {
  planner: RoutePlannerState;
  drive: DriveControls;
  onClose: () => void;
}

const DirectionsPanel: React.FC<Props> = ({ planner, onClose }) => {
  const {
    start,
    end,
    pickMode,
    setPickMode,
    setStartPoint,
    setEndPoint,
    swap,
  } = planner;
  const { result, activeRoute, setActiveRoute, loading, error } = planner;

  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [focus, setFocus] = useState<"start" | "end" | null>(null);
  const named = useRef<{ start: LonLat | null; end: LonLat | null }>({
    start: null,
    end: null,
  });

  // Keep the boxes in sync when a point is set from the map (or swapped / cleared)
  useEffect(() => {
    if (!start) setStartText("");
    else if (
      named.current.start?.[0] !== start[0] ||
      named.current.start?.[1] !== start[1]
    )
      setStartText(coordText(start));
  }, [start]);
  useEffect(() => {
    if (!end) setEndText("");
    else if (
      named.current.end?.[0] !== end[0] ||
      named.current.end?.[1] !== end[1]
    )
      setEndText(coordText(end));
  }, [end]);

  const suggestions: MarsLocation[] = useMemo(() => {
    const q = (focus === "start" ? startText : endText).trim();
    const base =
      q && !/°/.test(q)
        ? searchMarsLocations(q, MARS_LOCATIONS)
        : MARS_LOCATIONS;
    return (base || []).slice(0, 6);
  }, [focus, startText, endText]);

  const choose = (loc: MarsLocation) => {
    const p: LonLat = [loc.lon, loc.lat];
    if (focus === "start") {
      named.current.start = p;
      setStartText(loc.name);
      setStartPoint(p);
    } else {
      named.current.end = p;
      setEndText(loc.name);
      setEndPoint(p);
    }
    setFocus(null);
  };

  const routes = result?.routes ?? [];

  const inputClass = (active: boolean) =>
    `w-full rounded-lg border px-3 py-2.5 text-sm text-white placeholder-white/40 bg-[#08090b] outline-none ${
      active ? "border-[#cc5500] ring-1 ring-[#cc5500]" : "border-white/10"
    }`;

  return (
    <div className="absolute left-4 top-[4.5rem] z-[60] flex h-[28rem] max-h-[calc(100%-6rem)] w-72 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111317]/95 text-white shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <button
          onClick={onClose}
          className="rounded-full p-2 hover:bg-white/10"
          title="Close directions"
        >
          <X className="h-4 w-4 text-white/70" />
        </button>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/85">
          <Navigation className="h-4 w-4 text-orange-300" />
          <span>Mission route</span>
        </div>
        <div className="w-9" />
      </div>

      {/* Start / destination */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <div className="flex flex-col items-center gap-1 pt-1">
          <span className="block h-3.5 w-3.5 rounded-full border-2 border-white/60 bg-transparent" />
          <span className="block h-1 w-0.5 bg-white/25" />
          <span className="block h-1 w-0.5 bg-white/25" />
          <span className="block h-1 w-0.5 bg-white/25" />
          <MapPin className="h-5 w-5 fill-[#cc5500] text-[#cc5500]" />
        </div>
        <div className="flex-1 space-y-2">
          <input
            value={startText}
            onChange={(e) => {
              setStartText(e.target.value);
              named.current.start = null;
            }}
            onFocus={() => {
              setFocus("start");
              setPickMode("pickStart");
            }}
            onBlur={() =>
              setTimeout(() => setFocus((f) => (f === "start" ? null : f)), 150)
            }
            placeholder="Start point · search or click map"
            className={inputClass(
              focus === "start" || pickMode === "pickStart"
            )}
          />
          <input
            value={endText}
            onChange={(e) => {
              setEndText(e.target.value);
              named.current.end = null;
            }}
            onFocus={() => {
              setFocus("end");
              setPickMode("pickEnd");
            }}
            onBlur={() =>
              setTimeout(() => setFocus((f) => (f === "end" ? null : f)), 150)
            }
            placeholder="Destination · search or click map"
            className={inputClass(focus === "end" || pickMode === "pickEnd")}
          />
        </div>
        <button
          onClick={() => {
            const s = named.current.start;
            named.current.start = named.current.end;
            named.current.end = s;
            setStartText(endText);
            setEndText(startText);
            swap();
          }}
          disabled={!start || !end}
          className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30"
          title="Swap start and destination"
        >
          <ArrowDownUp className="h-4 w-4 text-white/70" />
        </button>
      </div>

      <div className="border-t border-white/10" />

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {focus && (
          <ul className="py-2">
            {suggestions.map((loc) => (
              <li key={`${loc.name}-${loc.lat}-${loc.lon}`}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(loc)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5">
                    <MapPin className="h-4 w-4 text-orange-300" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">
                      {loc.name}
                    </span>
                    <span className="block truncate text-xs text-white/45">
                      {loc.type} · {coordText([loc.lon, loc.lat])}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!focus && !start && !end && !loading && (
          <div className="space-y-3 px-4 py-5 text-sm text-white/60">
            <p>
              Choose a start and destination by clicking the map or entering
              coordinates.
            </p>
            <button
              type="button"
              data-testid="jezero-demo-route"
              onClick={() => {
                const demoStart: LonLat = [77.35, 18.5];
                const demoEnd: LonLat = [77.39, 18.52];
                named.current = { start: demoStart, end: demoEnd };
                setStartText("Jezero delta demo · 18.500°N, 77.350°E");
                setEndText("Jezero delta demo · 18.520°N, 77.390°E");
                setStartPoint(demoStart);
                setEndPoint(demoEnd);
              }}
              className="w-full rounded-lg border border-orange-300/25 bg-orange-500/10 px-3 py-2 text-left text-xs font-semibold text-orange-100 transition hover:bg-orange-500/20"
            >
              Load Jezero delta-slope CTX transect
              <span className="mt-1 block text-[10px] font-normal text-white/55">
                20 m terrain · matching 6 m orthophoto · verified CTX coverage
              </span>
            </button>
            <p className="text-xs leading-relaxed text-white/40">
              In Jezero, routes use the local 20 m CTX DTM and the mission view
              drapes its matching 6 m orthophoto. Elsewhere, bundled MOLA
              elevation is global context only and cannot resolve rover-scale
              hazards.
            </p>
          </div>
        )}
        {!focus && (start || end) && !(start && end) && (
          <div className="px-4 py-4 text-sm text-white/55">
            {start
              ? "Now choose the destination."
              : "Now choose the starting point."}
          </div>
        )}

        {!focus && loading && (
          <div className="animate-pulse px-4 py-5 text-sm text-white/60">
            Calculating route…
          </div>
        )}
        {!focus && error && (
          <div className="m-3 rounded-lg bg-red-950/60 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {!focus && result && !loading && (
          <div>
            <div className="px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-white/40">
              Choose routing algorithm
            </div>
            {routes.map((r) => {
              const active = r.id === activeRoute;
              return (
                <button
                  key={r.id}
                  disabled={!r.path}
                  onClick={() => setActiveRoute(r.id)}
                  className={`flex w-full items-center gap-3 border-b border-white/5 border-l-2 px-4 py-3 text-left transition ${
                    active
                      ? "bg-white/5"
                      : "border-l-transparent hover:bg-white/5"
                  }`}
                  style={active ? { borderLeftColor: r.color } : undefined}
                >
                  <span
                    className="w-3 h-3 rounded-full mt-1.5 shrink-0"
                    style={{ background: r.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">
                      {r.name}
                    </div>
                    {r.error ? (
                      <div className="mt-1 text-xs text-red-300">{r.error}</div>
                    ) : (
                      <div className="mt-0.5 text-xs text-white/45">
                        {r.tagline}
                      </div>
                    )}
                  </div>
                  {!r.error && (
                    <div className="shrink-0 text-right">
                      <div className="text-sm text-white/85">
                        {formatDistance(r.length_km)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-white/40">
                        {r.nodes_expanded?.toLocaleString() ?? "—"} nodes
                        expanded
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
            <div className="px-4 py-2 text-[10px] leading-snug text-white/45">
              {result.terrain === "No DEM configured"
                ? "No DEM: A* and UCS share the distance-only cost and can return the same route; the node counts show their different search work. Configure quantitative Mars elevation data for terrain-aware costs."
                : result.terrain.includes("MOLA MEGDR")
                ? `Elevation source: ${result.terrain}. A* balances distance and slope; UCS minimizes cumulative slope-weighted cost more conservatively. This 4 ppd grid resolves broad terrain, not rover-scale hazards.`
                : `Terrain source: ${result.terrain}. A* balances distance and slope; UCS minimizes cumulative slope-weighted cost more conservatively.`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DirectionsPanel;
