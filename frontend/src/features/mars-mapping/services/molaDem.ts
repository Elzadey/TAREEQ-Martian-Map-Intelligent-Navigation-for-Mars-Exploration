import {
  CustomHeightmapTerrainProvider,
  Ellipsoid,
  GeographicTilingScheme,
} from "cesium";

export const MOLA_DEM_LABEL = "NASA MOLA MEGDR · 4 ppd (~14.8 km at equator)";
export const MOLA_AREOID_LABEL = "NASA MOLA areoid · 4 ppd";
export const MOLA_SAMPLE_ROWS = 720;
export const MOLA_SAMPLE_COLUMNS = 1440;
const MOLA_BYTES_PER_SAMPLE = 2;
const EXPECTED_BYTES =
  MOLA_SAMPLE_ROWS * MOLA_SAMPLE_COLUMNS * MOLA_BYTES_PER_SAMPLE;
const SAMPLES_PER_DEGREE = 4;
const MOLA_AREOID_REFERENCE_RADIUS_M = 3_396_000;
const MARS_EQUATORIAL_RADIUS_M = 3_396_190;
const MARS_POLAR_RADIUS_M = 3_376_200;
const TERRAIN_TILE_SIZE = 65;

export interface MolaDem {
  /** Bilinear MOLA topography sample in metres above/below the source areoid. */
  sampleElevation(
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number
  ): number;
  /** Bilinear absolute areoid radius from the PDS 4 ppd areoid grid, in metres. */
  sampleAreoidRadius?(
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number
  ): number;
  /** Convert an areoid-referenced source elevation to Mars ellipsoid height. */
  ellipsoidHeightFromAreoidElevation?(
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number,
    sourceElevationMeters: number
  ): number;
}

let molaDemPromise: Promise<MolaDem> | null = null;

function planetographicToPlanetocentric(latitudeDegrees: number): number {
  const latitude = (latitudeDegrees * Math.PI) / 180;
  const equatorialSquared = MARS_EQUATORIAL_RADIUS_M ** 2;
  const polarSquared = MARS_POLAR_RADIUS_M ** 2;
  return (
    (Math.atan2(
      polarSquared * Math.sin(latitude),
      equatorialSquared * Math.cos(latitude)
    ) *
      180) /
    Math.PI
  );
}

function interpolate(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}

function decodeSignedBigEndianGrid(buffer: ArrayBuffer, label: string): Int16Array {
  if (buffer.byteLength !== EXPECTED_BYTES) {
    throw new Error(
      `${label} file size mismatch: expected ${EXPECTED_BYTES} bytes, received ${buffer.byteLength}`
    );
  }
  const view = new DataView(buffer);
  const values = new Int16Array(MOLA_SAMPLE_ROWS * MOLA_SAMPLE_COLUMNS);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getInt16(index * MOLA_BYTES_PER_SAMPLE, false);
  }
  return values;
}

function sampleGrid(
  values: Int16Array,
  longitudeDegrees: number,
  planetocentricLatitudeDegrees: number
): number {
  const longitude360 = ((longitudeDegrees % 360) + 360) % 360;
  // PDS cells are centred: the first sample is at 0.125°E, 89.875°N.
  const column =
    (longitude360 * SAMPLES_PER_DEGREE - 0.5 + MOLA_SAMPLE_COLUMNS) %
    MOLA_SAMPLE_COLUMNS;
  const row = Math.max(
    0,
    Math.min(
      MOLA_SAMPLE_ROWS - 1,
      (90 - planetocentricLatitudeDegrees) * SAMPLES_PER_DEGREE - 0.5
    )
  );
  const column0 = Math.floor(column);
  const column1 = (column0 + 1) % MOLA_SAMPLE_COLUMNS;
  const row0 = Math.floor(row);
  const row1 = Math.min(MOLA_SAMPLE_ROWS - 1, row0 + 1);
  const xFraction = column - column0;
  const yFraction = row - row0;
  const northWest = values[row0 * MOLA_SAMPLE_COLUMNS + column0];
  const northEast = values[row0 * MOLA_SAMPLE_COLUMNS + column1];
  const southWest = values[row1 * MOLA_SAMPLE_COLUMNS + column0];
  const southEast = values[row1 * MOLA_SAMPLE_COLUMNS + column1];

  return interpolate(
    interpolate(northWest, northEast, xFraction),
    interpolate(southWest, southEast, xFraction),
    yFraction
  );
}

/**
 * Decode official PDS4 MOLA topography and, when supplied, its matching areoid grid.
 * Topography remains in the source areoid datum; the optional converter is only for
 * constructing positions in Cesium's Mars reference-ellipsoid coordinate system.
 */
export function decodeMolaDem(
  topographyBuffer: ArrayBuffer,
  areoidBuffer?: ArrayBuffer
): MolaDem {
  const topography = decodeSignedBigEndianGrid(
    topographyBuffer,
    "MOLA topography"
  );
  const areoid = areoidBuffer
    ? decodeSignedBigEndianGrid(areoidBuffer, "MOLA areoid")
    : null;

  const sampleSourceGrid = (
    values: Int16Array,
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number
  ): number =>
    sampleGrid(
      values,
      longitudeDegrees,
      planetographicToPlanetocentric(planetographicLatitudeDegrees)
    );

  const sampleElevation = (
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number
  ): number =>
    sampleSourceGrid(
      topography,
      longitudeDegrees,
      planetographicLatitudeDegrees
    );

  if (!areoid) return { sampleElevation };

  const sampleAreoidRadius = (
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number
  ): number =>
    sampleSourceGrid(
      areoid,
      longitudeDegrees,
      planetographicLatitudeDegrees
    ) + MOLA_AREOID_REFERENCE_RADIUS_M;

  const ellipsoidHeightFromAreoidElevation = (
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number,
    sourceElevationMeters: number
  ): number => {
    const planetocentricLatitudeDegrees = planetographicToPlanetocentric(
      planetographicLatitudeDegrees
    );
    const planetocentricLatitude =
      (planetocentricLatitudeDegrees * Math.PI) / 180;
    const longitude = (longitudeDegrees * Math.PI) / 180;
    const surfaceRadius =
      sampleAreoidRadius(longitudeDegrees, planetographicLatitudeDegrees) +
      sourceElevationMeters;

    // The source DTM is radial/areoid referenced. Build its actual body-fixed
    // Cartesian point, then convert that point to geodetic height above IAU2000 Mars.
    const horizontalRadius = surfaceRadius * Math.cos(planetocentricLatitude);
    const z = surfaceRadius * Math.sin(planetocentricLatitude);
    const x = horizontalRadius * Math.cos(longitude);
    const y = horizontalRadius * Math.sin(longitude);
    const p = Math.hypot(x, y);
    const e2 =
      (MARS_EQUATORIAL_RADIUS_M ** 2 - MARS_POLAR_RADIUS_M ** 2) /
      MARS_EQUATORIAL_RADIUS_M ** 2;
    const ep2 =
      (MARS_EQUATORIAL_RADIUS_M ** 2 - MARS_POLAR_RADIUS_M ** 2) /
      MARS_POLAR_RADIUS_M ** 2;
    const bowringTheta = Math.atan2(
      z * MARS_EQUATORIAL_RADIUS_M,
      p * MARS_POLAR_RADIUS_M
    );
    const geodeticLatitude = Math.atan2(
      z + ep2 * MARS_POLAR_RADIUS_M * Math.sin(bowringTheta) ** 3,
      p - e2 * MARS_EQUATORIAL_RADIUS_M * Math.cos(bowringTheta) ** 3
    );
    const primeVerticalRadius =
      MARS_EQUATORIAL_RADIUS_M /
      Math.sqrt(1 - e2 * Math.sin(geodeticLatitude) ** 2);

    return (
      p / Math.cos(geodeticLatitude) - primeVerticalRadius
    );
  };

  return {
    sampleElevation,
    sampleAreoidRadius,
    ellipsoidHeightFromAreoidElevation,
  };
}

/** Load and cache the bundled NASA/PDS 4 ppd topography and areoid grids. */
export function loadMolaDem(): Promise<MolaDem> {
  if (!molaDemPromise) {
    const publicRoot = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
    const dataRoot = `${publicRoot}/data`;
    const fetchGrid = (filename: string) =>
      fetch(`${dataRoot}/${filename}`, { cache: "force-cache" }).then(
        (response) => {
          if (!response.ok) {
            throw new Error(
              `Unable to load bundled MOLA ${filename} (${response.status})`
            );
          }
          return response.arrayBuffer();
        }
      );

    molaDemPromise = Promise.all([
      fetchGrid("megt90n000cb.img"),
      fetchGrid("mega90n000cb.img"),
    ])
      .then(([topography, areoid]) => decodeMolaDem(topography, areoid))
      .catch((error: unknown) => {
        molaDemPromise = null;
        throw error;
      });
  }
  return molaDemPromise;
}

/** Build a Cesium terrain provider from real MOLA source elevations. */
export function createMolaTerrainProvider(
  dem: MolaDem,
  ellipsoid: Ellipsoid,
  renderOriginOffsetMeters = 0
): CustomHeightmapTerrainProvider {
  const tilingScheme = new GeographicTilingScheme({ ellipsoid });
  return new CustomHeightmapTerrainProvider({
    width: TERRAIN_TILE_SIZE,
    height: TERRAIN_TILE_SIZE,
    tilingScheme,
    credit: "MGS MOLA MEGDR 4 ppd · NASA/PDS",
    callback: (x, y, level) => {
      const rectangle = tilingScheme.tileXYToRectangle(x, y, level);
      const heights = new Float32Array(TERRAIN_TILE_SIZE * TERRAIN_TILE_SIZE);
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
          const sourceElevation = dem.sampleElevation(longitude, latitude);
          const ellipsoidHeight =
            dem.ellipsoidHeightFromAreoidElevation?.(
              longitude,
              latitude,
              sourceElevation
            ) ?? sourceElevation;
          // Float32 terrain samples are metres; local render-origin translation
          // is applied only for mission scenes, never to the stored source values.
          heights[row * TERRAIN_TILE_SIZE + column] =
            ellipsoidHeight + renderOriginOffsetMeters;
        }
      }
      return heights;
    },
  });
}
