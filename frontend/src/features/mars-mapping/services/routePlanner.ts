// Thin wrapper around the TAREEQ search algorithms (see route-planning/algorithms.ts).
import {
  Cartographic,
  CesiumTerrainProvider,
  Ellipsoid,
  sampleTerrainMostDetailed,
} from "cesium";
import {
  getPlanningBounds,
  getPlanningGridCoordinates,
  LonLat,
  planRoutesLocal,
  RoutePlanResponse,
} from "../../route-planning/algorithms";
import { JEZERO_DEM_LABEL, loadJezeroDem } from "./jezeroDem";
import { loadMolaDem, MOLA_DEM_LABEL } from "./molaDem";

export type {
  AlgoId,
  LonLat,
  RoutePlanResponse,
  RouteResult,
} from "../../route-planning/algorithms";
export { ALGORITHMS, ALGO_ORDER } from "../../route-planning/algorithms";

let marsTerrainProvider: Promise<CesiumTerrainProvider> | null = null;

async function planWithBundledMola(
  start: LonLat,
  end: LonLat,
  label = MOLA_DEM_LABEL
): Promise<RoutePlanResponse> {
  const dem = await loadMolaDem();
  const coordinates = getPlanningGridCoordinates(start, end);
  const elevations = coordinates.map(([longitude, latitude]) =>
    dem.sampleElevation(longitude, latitude)
  );
  return planRoutesLocal(start, end, new Float64Array(elevations), label);
}

/**
 * Use the verified high-resolution Jezero pair only when the complete planning grid
 * is inside its DTM footprint and every sampled cell is valid. Otherwise use the
 * configured/global DEM; never extrapolate the Jezero raster to another region.
 */
async function planWithJezeroIfCovered(
  start: LonLat,
  end: LonLat
): Promise<RoutePlanResponse | null> {
  try {
    const dem = await loadJezeroDem();
    if (!dem.coversPath([start, end])) return null;

    const planningBounds = getPlanningBounds(start, end, dem.bounds);
    const coordinates = getPlanningGridCoordinates(start, end, planningBounds);
    const sampled = coordinates.map(([longitude, latitude]) =>
      dem.sampleElevation(longitude, latitude)
    );
    if (sampled.some((height) => height === null || !Number.isFinite(height))) {
      return null;
    }

    return planRoutesLocal(
      start,
      end,
      new Float64Array(sampled as number[]),
      JEZERO_DEM_LABEL,
      planningBounds
    );
  } catch {
    // The Jezero data are optional for route planning; the global/configured DEM remains available.
    return null;
  }
}

/** Use Jezero CTX when covered; elsewhere use the configured Mars terrain or bundled global MOLA. */
export async function planRoutes(
  start: LonLat,
  end: LonLat
): Promise<RoutePlanResponse> {
  const jezeroRoutes = await planWithJezeroIfCovered(start, end);
  if (jezeroRoutes) return jezeroRoutes;

  const terrainUrl = process.env.REACT_APP_MARS_TERRAIN_URL;
  if (!terrainUrl) return planWithBundledMola(start, end);

  if (!marsTerrainProvider) {
    marsTerrainProvider = CesiumTerrainProvider.fromUrl(terrainUrl, {
      ellipsoid: new Ellipsoid(3_396_190, 3_396_190, 3_376_200),
      requestVertexNormals: true,
    });
  }

  try {
    const provider = await marsTerrainProvider;
    const coordinates = getPlanningGridCoordinates(start, end);
    const positions = coordinates.map(([longitude, latitude]) =>
      Cartographic.fromDegrees(longitude, latitude)
    );
    const sampled = await sampleTerrainMostDetailed(provider, positions);
    const elevations = sampled.map(({ height }) => height);
    if (elevations.some((height) => !Number.isFinite(height))) {
      throw new Error(
        "Configured Mars DEM has no elevation coverage for part of this route."
      );
    }

    return planRoutesLocal(
      start,
      end,
      new Float64Array(elevations),
      "Configured higher-resolution Mars DEM"
    );
  } catch (error) {
    marsTerrainProvider = null;
    const fallback = await planWithBundledMola(
      start,
      end,
      `${MOLA_DEM_LABEL} (fallback)`
    );
    if (process.env.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.warn(
        "Configured Mars DEM unavailable; routes use bundled MOLA MEGDR instead.",
        error
      );
    }
    return fallback;
  }
}
