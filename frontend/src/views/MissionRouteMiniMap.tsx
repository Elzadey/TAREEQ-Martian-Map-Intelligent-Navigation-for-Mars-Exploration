import React, { useMemo } from "react";
import type { LonLat } from "../features/route-planning/algorithms";

interface MissionRouteMiniMapProps {
  path: LonLat[];
  current: LonLat;
  progress: number;
  elevationProfile?: Array<number | null>;
  elevationSource?: string;
}

type MapPoint = { x: number; y: number };

const MAP_WIDTH = 188;
const MAP_HEIGHT = 112;
const MAP_PADDING = 12;
const PROFILE_HEIGHT = 48;

const unwrapLongitude = (longitude: number, reference: number): number => {
  let unwrapped = longitude;
  while (unwrapped - reference > 180) unwrapped -= 360;
  while (unwrapped - reference < -180) unwrapped += 360;
  return unwrapped;
};

const toPath = (points: MapPoint[]): string =>
  points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

const MissionRouteMiniMap: React.FC<MissionRouteMiniMapProps> = ({
  path,
  current,
  progress,
  elevationProfile = [],
  elevationSource = "",
}) => {
  const map = useMemo(() => {
    if (path.length === 0) return null;

    const unwrappedPath: LonLat[] = path.map((point, index) => {
      if (index === 0) return point;
      return [unwrapLongitude(point[0], path[index - 1][0]), point[1]];
    });
    const currentPoint: LonLat = [
      unwrapLongitude(current[0], unwrappedPath[0][0]),
      current[1],
    ];
    const midLatitude =
      unwrappedPath.reduce((total, point) => total + point[1], 0) /
      unwrappedPath.length;
    const longitudeScale = Math.max(
      0.15,
      Math.cos((midLatitude * Math.PI) / 180)
    );
    const projected = [...unwrappedPath, currentPoint].map(([lon, lat]) => ({
      x: lon * longitudeScale,
      y: lat,
    }));
    const minX = Math.min(...projected.map((point) => point.x));
    const maxX = Math.max(...projected.map((point) => point.x));
    const minY = Math.min(...projected.map((point) => point.y));
    const maxY = Math.max(...projected.map((point) => point.y));
    const spanX = Math.max(0.0001, maxX - minX);
    const spanY = Math.max(0.0001, maxY - minY);
    const availableWidth = MAP_WIDTH - MAP_PADDING * 2;
    const availableHeight = MAP_HEIGHT - MAP_PADDING * 2;
    const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
    const drawnWidth = spanX * scale;
    const drawnHeight = spanY * scale;
    const offsetX = (MAP_WIDTH - drawnWidth) / 2;
    const offsetY = (MAP_HEIGHT - drawnHeight) / 2;
    const project = (point: LonLat): MapPoint => ({
      x: offsetX + (point[0] * longitudeScale - minX) * scale,
      y: MAP_HEIGHT - offsetY - (point[1] - minY) * scale,
    });
    const routePoints = unwrappedPath.map(project);
    const normalizedProgress = Math.max(0, Math.min(1, progress));
    const currentIndex = Math.floor(
      normalizedProgress * Math.max(0, unwrappedPath.length - 1)
    );
    const traveledPoints = [
      ...routePoints.slice(0, currentIndex + 1),
      project(currentPoint),
    ];

    return {
      route: toPath(routePoints),
      traveled: toPath(traveledPoints),
      start: routePoints[0],
      end: routePoints[routePoints.length - 1],
      rover: project(currentPoint),
      percent: Math.round(normalizedProgress * 100),
    };
  }, [current, path, progress]);

  const elevation = useMemo(() => {
    const valid = elevationProfile.filter(
      (value): value is number => value !== null && Number.isFinite(value)
    );
    if (elevationSource.length === 0 || valid.length < 2) return null;

    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const span = Math.max(1, max - min);
    const padding = 6;
    const routePath = elevationProfile
      .map((value, index) => {
        if (value === null || !Number.isFinite(value)) return null;
        const x =
          padding +
          (index / Math.max(1, elevationProfile.length - 1)) *
            (MAP_WIDTH - padding * 2);
        const y =
          PROFILE_HEIGHT -
          padding -
          ((value - min) / span) * (PROFILE_HEIGHT - padding * 2);
        return { x, y };
      })
      .reduce<{ path: string; penUp: boolean }>(
        (state, point) => {
          if (!point) return { ...state, penUp: true };
          return {
            path: `${state.path}${state.penUp ? "M" : "L"}${point.x},${point.y} `,
            penUp: false,
          };
        },
        { path: "", penUp: true }
      ).path.trim();
    const currentIndex = Math.round(
      Math.max(0, Math.min(1, progress)) *
        Math.max(0, elevationProfile.length - 1)
    );
    const currentValue = elevationProfile[currentIndex];
    const currentX =
      padding +
      (currentIndex / Math.max(1, elevationProfile.length - 1)) *
        (MAP_WIDTH - padding * 2);
    const currentY =
      currentValue === null || currentValue === undefined
        ? null
        : PROFILE_HEIGHT -
          padding -
          ((currentValue - min) / span) * (PROFILE_HEIGHT - padding * 2);

    return {
      path: routePath,
      min,
      max,
      range: max - min,
      first: elevationProfile[0] ?? null,
      last: elevationProfile[elevationProfile.length - 1] ?? null,
      currentX,
      currentY,
    };
  }, [elevationProfile, elevationSource, progress]);

  if (!map || path.length < 2) return null;

  return (
    <section className="absolute right-4 top-16 z-20 w-[212px] rounded-2xl border border-white/15 bg-[#111317]/90 p-3 text-white shadow-2xl backdrop-blur-md sm:right-6 sm:top-20">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/75">
          Local route
        </h2>
        <span className="text-[10px] tabular-nums text-orange-200">
          {map.percent}%
        </span>
      </div>
      <svg
        aria-label="Mission route overview"
        className="block h-auto w-full overflow-visible"
        data-testid="mission-route-map"
        role="img"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      >
        <title>Mission route overview</title>
        <path
          d={map.route}
          fill="none"
          stroke="#5b626d"
          strokeDasharray="3 3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          data-testid="mission-route-full-path"
        />
        <path
          d={map.traveled}
          fill="none"
          stroke="#e87524"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          data-testid="mission-route-traveled-path"
        />
        <circle cx={map.start.x} cy={map.start.y} fill="#f5f5f5" r="3.5" />
        <circle
          cx={map.end.x}
          cy={map.end.y}
          fill="#e87524"
          r="4"
          stroke="#fff"
          strokeWidth="1"
        />
        <circle
          cx={map.rover.x}
          cy={map.rover.y}
          fill="#9bf6c2"
          r="4.2"
          stroke="#0b2418"
          strokeWidth="1.5"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[8px] font-medium uppercase tracking-[0.12em] text-white/45">
        <span>Start</span>
        <span>Rover</span>
        <span>Destination</span>
      </div>
      {elevation && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-[8px] uppercase tracking-[0.12em] text-white/65">
            <span>Elevation · {elevationSource}</span>
            <span>{Math.round(elevation.range).toLocaleString()} m range</span>
          </div>
          <svg
            aria-label={`Elevation profile from ${elevationSource}`}
            className="block h-12 w-full"
            data-testid="mission-elevation-profile"
            role="img"
            viewBox={`0 0 ${MAP_WIDTH} ${PROFILE_HEIGHT}`}
          >
            <line
              x1="6"
              y1={PROFILE_HEIGHT - 6}
              x2={MAP_WIDTH - 6}
              y2={PROFILE_HEIGHT - 6}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
            />
            <path
              d={elevation.path}
              fill="none"
              stroke="#78c8ff"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              data-testid="mission-elevation-path"
            />
            <line
              x1={elevation.currentX}
              y1="4"
              x2={elevation.currentX}
              y2={PROFILE_HEIGHT - 4}
              stroke="#e87524"
              strokeDasharray="2 2"
              strokeWidth="1"
            />
            {elevation.currentY !== null && (
              <circle
                cx={elevation.currentX}
                cy={elevation.currentY}
                r="3"
                fill="#e87524"
                stroke="#fff"
                strokeWidth="1"
              />
            )}
          </svg>
          <div className="mt-0.5 flex justify-between text-[8px] tabular-nums text-white/45">
            <span>Start {elevation.first === null ? "—" : `${Math.round(elevation.first).toLocaleString()} m`}</span>
            <span>End {elevation.last === null ? "—" : `${Math.round(elevation.last).toLocaleString()} m`}</span>
          </div>
        </div>
      )}
    </section>
  );
};

export default MissionRouteMiniMap;
