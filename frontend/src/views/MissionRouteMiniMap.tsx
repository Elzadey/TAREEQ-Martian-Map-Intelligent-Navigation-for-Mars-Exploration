import React, { useMemo } from "react";
import type { LonLat } from "../features/route-planning/algorithms";

interface MissionRouteMiniMapProps {
  path: LonLat[];
  current: LonLat;
  progress: number;
}

type MapPoint = { x: number; y: number };

const MAP_WIDTH = 188;
const MAP_HEIGHT = 112;
const MAP_PADDING = 12;

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
    </section>
  );
};

export default MissionRouteMiniMap;
