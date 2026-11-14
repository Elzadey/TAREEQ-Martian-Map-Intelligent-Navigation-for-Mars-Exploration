import {
  CustomHeightmapTerrainProvider,
  Ellipsoid,
  GeographicTilingScheme,
  Rectangle,
  SingleTileImageryProvider,
} from "cesium";
import type { LonLat } from "../../route-planning/algorithms";
import type { MolaDem } from "./molaDem";

export const JEZERO_DEM_LABEL = "NASA/USGS CTX Jezero DTM · 20 m";
export const JEZERO_ORTHO_LABEL = "NASA/USGS CTX Jezero orthophoto · 6 m";
export const JEZERO_DATA_ROOT = "/data/jezero";
const TERRAIN_TILE_SIZE = 65;
const NODATA_LIMIT = -1e30;
const MARS_EQUATORIAL_RADIUS_M = 3_396_190;
const MARS_POLAR_RADIUS_M = 3_376_200;

export interface MarsBoundsDegrees {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface RasterMetadata {
  sourceFile: string;
  width: number;
  height: number;
  bands: number;
  dataType: string;
  resolutionMeters: [number, number];
  transform: [number, number, number, number, number, number];
  boundsProjectedMeters: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  boundsDegrees: MarsBoundsDegrees;
  noData: number | null;
  browserFile: string;
  byteOrder?: string;
}

interface JezeroMetadata {
  region: string;
  sourceCrs: string;
  marsRadiusMeters: number;
  coordinateConvention: string;
  elevationReference: string;
  dem: RasterMetadata & {
    validElevationMinMeters: number;
    validElevationMaxMeters: number;
  };
  orthophoto: RasterMetadata;
}

export interface JezeroDem {
  readonly label: string;
  readonly bounds: MarsBoundsDegrees;
  readonly orthophotoBounds: MarsBoundsDegrees;
  readonly orthophotoWidth: number;
  readonly orthophotoHeight: number;
  readonly width: number;
  readonly height: number;
  readonly resolutionMeters: number;
  readonly marsRadiusMeters: number;
  readonly elevationReference: string;
  /** Returns the original bilinearly interpolated DTM value in metres, or null outside valid coverage. */
  sampleElevation(
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number
  ): number | null;
  /** True only if the complete path samples valid cells inside this raster footprint. */
  coversPath(path: LonLat[]): boolean;
}

let jezeroDemPromise: Promise<JezeroDem> | null = null;

function planetographicToPlanetocentric(latitudeDegrees: number): number {
  const latitude = (latitudeDegrees * Math.PI) / 180;
  return (
    (Math.atan2(
      MARS_POLAR_RADIUS_M ** 2 * Math.sin(latitude),
      MARS_EQUATORIAL_RADIUS_M ** 2 * Math.cos(latitude)
    ) *
      180) /
    Math.PI
  );
}

function planetocentricToPlanetographic(latitudeDegrees: number): number {
  const latitude = (latitudeDegrees * Math.PI) / 180;
  return (
    (Math.atan2(
      MARS_EQUATORIAL_RADIUS_M ** 2 * Math.sin(latitude),
      MARS_POLAR_RADIUS_M ** 2 * Math.cos(latitude)
    ) *
      180) /
    Math.PI
  );
}

function sourceBoundsToPlanetographic(
  bounds: MarsBoundsDegrees
): MarsBoundsDegrees {
  return {
    west: bounds.west,
    south: planetocentricToPlanetographic(bounds.south),
    east: bounds.east,
    north: planetocentricToPlanetographic(bounds.north),
  };
}

function interpolate(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}

function distanceMeters(a: LonLat, b: LonLat): number {
  const latitudeRadians = ((a[1] + b[1]) * Math.PI) / 360;
  const eastMeters =
    ((b[0] - a[0]) * Math.PI * 3_396_190 * Math.cos(latitudeRadians)) / 180;
  const northMeters = ((b[1] - a[1]) * Math.PI * 3_396_190) / 180;
  return Math.hypot(eastMeters, northMeters);
}

function isValidHeight(value: number, noData: number | null): boolean {
  return (
    Number.isFinite(value) &&
    value > NODATA_LIMIT &&
    (noData === null || value !== noData)
  );
}

function decodeFloat32LittleEndian(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(
      "Jezero CTX DEM byte length is not a whole number of float32 samples."
    );
  }
  const sample = new Uint16Array([1]);
  const littleEndian = new Uint8Array(sample.buffer)[0] === 1;
  if (littleEndian) return new Float32Array(buffer);

  const view = new DataView(buffer);
  const values = new Float32Array(buffer.byteLength / 4);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getFloat32(index * 4, true);
  }
  return values;
}

export function decodeJezeroDem(
  heightBuffer: ArrayBuffer,
  metadata: JezeroMetadata
): JezeroDem {
  const raster = metadata.dem;
  const expectedSamples = raster.width * raster.height;
  if (heightBuffer.byteLength !== expectedSamples * 4) {
    throw new Error(
      `Jezero CTX DEM size mismatch: expected ${
        expectedSamples * 4
      } bytes, received ${heightBuffer.byteLength}.`
    );
  }
  if (
    metadata.sourceCrs !== "ESRI:103885" ||
    !metadata.coordinateConvention.includes("planetocentric") ||
    metadata.marsRadiusMeters !== 3_396_190
  ) {
    throw new Error(
      "Jezero CTX DEM metadata does not match the verified Mars CRS."
    );
  }

  const heights = decodeFloat32LittleEndian(heightBuffer);
  const [pixelWidth, , originX, , pixelHeight, originY] = raster.transform;
  const radius = metadata.marsRadiusMeters;
  const radiansPerDegree = Math.PI / 180;
  const lonLatToGrid = (longitudeDegrees: number, latitudeDegrees: number) => {
    const x = longitudeDegrees * radiansPerDegree * radius;
    const sourceLatitude = planetographicToPlanetocentric(latitudeDegrees);
    const y = sourceLatitude * radiansPerDegree * radius;
    // GeoTIFF transform coordinates refer to pixel corners; sample at pixel centres.
    return {
      column: (x - originX) / pixelWidth - 0.5,
      row: (originY - y) / Math.abs(pixelHeight) - 0.5,
    };
  };

  const sampleElevation = (
    longitudeDegrees: number,
    latitudeDegrees: number
  ): number | null => {
    const { column, row } = lonLatToGrid(longitudeDegrees, latitudeDegrees);
    const pixelTolerance = 1e-6;
    if (
      column < -0.5 - pixelTolerance ||
      row < -0.5 - pixelTolerance ||
      column > raster.width - 0.5 + pixelTolerance ||
      row > raster.height - 0.5 + pixelTolerance
    ) {
      return null;
    }

    const boundedColumn = Math.max(0, Math.min(raster.width - 1, column));
    const boundedRow = Math.max(0, Math.min(raster.height - 1, row));
    const col0 = Math.floor(boundedColumn);
    const row0 = Math.floor(boundedRow);
    const col1 = Math.min(raster.width - 1, col0 + 1);
    const row1 = Math.min(raster.height - 1, row0 + 1);
    const values = [
      heights[row0 * raster.width + col0],
      heights[row0 * raster.width + col1],
      heights[row1 * raster.width + col0],
      heights[row1 * raster.width + col1],
    ];
    if (values.some((value) => !isValidHeight(value, raster.noData)))
      return null;

    const xFraction = boundedColumn - col0;
    const yFraction = boundedRow - row0;
    return interpolate(
      interpolate(values[0], values[1], xFraction),
      interpolate(values[2], values[3], xFraction),
      yFraction
    );
  };

  const coversPath = (path: LonLat[]): boolean => {
    if (path.length < 2) return false;
    const { west, south, east, north } = bounds;
    const insideAndValid = (point: LonLat) =>
      point[0] >= west &&
      point[0] <= east &&
      point[1] >= south &&
      point[1] <= north &&
      sampleElevation(point[0], point[1]) !== null;

    for (let index = 0; index < path.length; index += 1) {
      const start = path[index];
      if (!insideAndValid(start)) return false;
      if (index === 0) continue;
      const previous = path[index - 1];
      const samples = Math.max(
        1,
        Math.ceil(distanceMeters(previous, start) / 100)
      );
      for (let step = 1; step < samples; step += 1) {
        const fraction = step / samples;
        const sample: LonLat = [
          previous[0] + (start[0] - previous[0]) * fraction,
          previous[1] + (start[1] - previous[1]) * fraction,
        ];
        if (!insideAndValid(sample)) return false;
      }
    }
    return true;
  };

  const bounds = sourceBoundsToPlanetographic(raster.boundsDegrees);
  return {
    label: JEZERO_DEM_LABEL,
    bounds,
    orthophotoBounds: sourceBoundsToPlanetographic(
      metadata.orthophoto.boundsDegrees
    ),
    orthophotoWidth: metadata.orthophoto.width,
    orthophotoHeight: metadata.orthophoto.height,
    width: raster.width,
    height: raster.height,
    resolutionMeters: Math.max(...raster.resolutionMeters),
    marsRadiusMeters: radius,
    elevationReference: metadata.elevationReference,
    sampleElevation,
    coversPath,
  };
}

export function loadJezeroDem(): Promise<JezeroDem> {
  if (!jezeroDemPromise) {
    const publicRoot = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
    const assetRoot = `${publicRoot}${JEZERO_DATA_ROOT}`;
    jezeroDemPromise = Promise.all([
      fetch(`${assetRoot}/jezero-ctx-metadata.json`, {
        cache: "force-cache",
      }).then((response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to load Jezero CTX metadata (${response.status}).`
          );
        }
        return response.json() as Promise<JezeroMetadata>;
      }),
      fetch(`${assetRoot}/jezero-ctx-dem-f32le.bin`, {
        cache: "force-cache",
      }).then((response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to load Jezero CTX DEM (${response.status}).`
          );
        }
        return response.arrayBuffer();
      }),
    ])
      .then(([metadata, heights]) => decodeJezeroDem(heights, metadata))
      .catch((error: unknown) => {
        jezeroDemPromise = null;
        throw error;
      });
  }
  return jezeroDemPromise;
}

/** Resample the original 20 m CTX height grid into Cesium heightmap tiles. */
export function createJezeroTerrainProvider(
  dem: JezeroDem,
  ellipsoid: Ellipsoid,
  fallbackDem: MolaDem | null = null,
  verticalDisplayOffsetMeters = 0
): CustomHeightmapTerrainProvider {
  const tilingScheme = new GeographicTilingScheme({ ellipsoid });
  return new CustomHeightmapTerrainProvider({
    width: TERRAIN_TILE_SIZE,
    height: TERRAIN_TILE_SIZE,
    tilingScheme,
    credit: "USGS/NASA Mars 2020 CTX Jezero DTM · 20 m",
    callback: (x, y, level) => {
      const rectangle = tilingScheme.tileXYToRectangle(x, y, level);
      const samples = new Float32Array(TERRAIN_TILE_SIZE * TERRAIN_TILE_SIZE);
      for (let row = 0; row < TERRAIN_TILE_SIZE; row += 1) {
        const latitude =
          ((rectangle.north -
            ((rectangle.north - rectangle.south) * row) /
              (TERRAIN_TILE_SIZE - 1)) *
            180) /
          Math.PI;
        for (let column = 0; column < TERRAIN_TILE_SIZE; column += 1) {
          const longitude =
            ((rectangle.west +
              ((rectangle.east - rectangle.west) * column) /
                (TERRAIN_TILE_SIZE - 1)) *
              180) /
            Math.PI;
          const regionalHeight = dem.sampleElevation(longitude, latitude);
          const sourceHeight =
            regionalHeight ??
            fallbackDem?.sampleElevation(longitude, latitude) ??
            0;
          // This constant translation is for rendering only; decoded/source DEM values stay unchanged.
          const height = sourceHeight + verticalDisplayOffsetMeters;
          // Cesium reads Float32 heightmap samples directly as metre values.
          // The 256 multiplier applies only to byte-packed heightmaps.
          samples[row * TERRAIN_TILE_SIZE + column] = height;
        }
      }
      return samples;
    },
  });
}

export function createJezeroOrthophotoProvider(
  dem: JezeroDem,
  ellipsoid: Ellipsoid,
  publicRoot = (process.env.PUBLIC_URL || "").replace(/\/$/, "")
): SingleTileImageryProvider {
  const { west, south, east, north } = dem.orthophotoBounds;
  return new SingleTileImageryProvider({
    url: `${publicRoot}${JEZERO_DATA_ROOT}/jezero-ctx-orthophoto.png`,
    tileWidth: dem.orthophotoWidth,
    tileHeight: dem.orthophotoHeight,
    rectangle: new Rectangle(
      (west * Math.PI) / 180,
      (south * Math.PI) / 180,
      (east * Math.PI) / 180,
      (north * Math.PI) / 180
    ),
    ellipsoid,
    credit: "USGS/NASA CTX Jezero orthophoto · 6 m",
  });
}
