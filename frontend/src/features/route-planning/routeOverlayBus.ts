import type { LonLat } from './algorithms';

export interface ActiveRouteOverlay {
	path: LonLat[];
	color: string;
}

export interface MissionRouteState extends ActiveRouteOverlay {
	name: string;
	algorithm: string;
	algorithmId?: string;
	start: LonLat | null;
	end: LonLat | null;
	distanceKm: number | null;
	durationHours: number | null;
	terrainSource: string;
	maxSlopeDeg?: number;
	averageSlopeDeg?: number;
	riskScore?: number;
}

type RouteOverlayListener = (route: ActiveRouteOverlay | null) => void;
type MissionRouteListener = (route: MissionRouteState | null) => void;

let activeRoute: ActiveRouteOverlay | null = null;
let missionRoute: MissionRouteState | null = null;
const routeListeners = new Set<RouteOverlayListener>();
const missionRouteListeners = new Set<MissionRouteListener>();

export function publishActiveRoute(route: ActiveRouteOverlay | null): void {
	activeRoute = route;
	routeListeners.forEach((listener) => listener(activeRoute));
}

export function publishMissionRouteState(route: MissionRouteState | null): void {
	missionRoute = route;
	missionRouteListeners.forEach((listener) => listener(missionRoute));
}

export function subscribeToActiveRoute(listener: RouteOverlayListener): () => void {
	routeListeners.add(listener);
	listener(activeRoute);
	return () => routeListeners.delete(listener);
}

export function subscribeToMissionRouteState(listener: MissionRouteListener): () => void {
	missionRouteListeners.add(listener);
	listener(missionRoute);
	return () => missionRouteListeners.delete(listener);
}
