import {
  CustomHeightmapTerrainProvider,
  Ellipsoid,
  GeographicTilingScheme,
} from "cesium";

export const MOLA_DEM_LABEL = "NASA MOLA MEGDR · 4 ppd (~14.8 km at equator)";
export const MOLA_SAMPLE_ROWS = 720;
export const MOLA_SAMPLE_COLUMNS = 1440;
const MOLA_BYTES_PER_SAMPLE = 2;
const EXPECTED_BYTES =
  MOLA_SAMPLE_ROWS * MOLA_SAMPLE_COLUMNS * MOLA_BYTES_PER_SAMPLE;
const SAMPLES_PER_DEGREE = 4;
const MARS_EQUATORIAL_RADIUS_M = 3_396_190;
const MARS_POLAR_RADIUS_M = 3_376_200;
const TERRAIN_TILE_SIZE = 65;

export interface MolaDem {
  /** Bilinear MOLA topography sample in metres, in the product's areoid datum. */
  sampleElevation(
    longitudeDegrees: number,
    planetographicLatitudeDegrees: number
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

/** Decode the official PDS4 SignedMSB2 (big-endian signed 16-bit) MEGDR image. */
export function decodeMolaDem(buffer: ArrayBuffer): MolaDem {
  if (buffer.byteLength !== EXPECTED_BYTES) {
    throw new Error(
      `MOLA DEM file size mismatch: expected ${EXPECTED_BYTES} bytes, received ${buffer.byteLength}`
    );
  }

  const view = new DataView(buffer);
  const heights = new Int16Array(MOLA_SAMPLE_ROWS * MOLA_SAMPLE_COLUMNS);
  for (let index = 0; index < heights.length; index += 1) {
    heights[index] = view.getInt16(index * MOLA_BYTES_PER_SAMPLE, false);
  }

  const sampleElevation = (
    longitudeDegrees: number,
    latitudeDegrees: number
  ): number => {
    const longitude360 = ((longitudeDegrees % 360) + 360) % 360;
    const planetocentricLatitude =
      planetographicToPlanetocentric(latitudeDegrees);

    // PDS pixels are cell-centred: the first sample is at 0.125°E, 89.875°N.
    const column =
      (longitude360 * SAMPLES_PER_DEGREE - 0.5 + MOLA_SAMPLE_COLUMNS) %
      MOLA_SAMPLE_COLUMNS;
    const row = Math.max(
      0,
      Math.min(
        MOLA_SAMPLE_ROWS - 1,
        (90 - planetocentricLatitude) * SAMPLES_PER_DEGREE - 0.5
      )
    );
    const column0 = Math.floor(column);
    const column1 = (column0 + 1) % MOLA_SAMPLE_COLUMNS;
    const row0 = Math.floor(row);
    const row1 = Math.min(MOLA_SAMPLE_ROWS - 1, row0 + 1);
    const xFraction = column - column0;
    const yFraction = row - row0;
    const northWest = heights[row0 * MOLA_SAMPLE_COLUMNS + column0];
    const northEast = heights[row0 * MOLA_SAMPLE_COLUMNS + column1];
    const southWest = heights[row1 * MOLA_SAMPLE_COLUMNS + column0];
    const southEast = heights[row1 * MOLA_SAMPLE_COLUMNS + column1];

    return interpolate(
      interpolate(northWest, northEast, xFraction),
      interpolate(southWest, southEast, xFraction),
      yFraction
    );
  };

  return { sampleElevation };
}

/** Load and cache the bundled global MOLA raster; the returned values are real PDS data, not synthetic terrain. */
export function loadMolaDem(): Promise<MolaDem> {
  if (!molaDemPromise) {
    const publicRoot = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
    const assetUrl =
      `${publicRoot}/data/megt90n000cb.img` || "/data/megt90n000cb.img";
    molaDemPromise = fetch(assetUrl, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            `Unable to load bundled MOLA DEM (${response.status})`
          );
        return response.arrayBuffer();
      })
      .then(decodeMolaDem)
      .catch((error: unknown) => {
        molaDemPromise = null;
        throw error;
      });
  }
  return molaDemPromise;
}

/** Build a Cesium terrain provider by resampling the bundled MOLA grid for each requested tile. */
export function createMolaTerrainProvider(
  dem: MolaDem,
  ellipsoid: Ellipsoid
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
          // Cesium reads Float32 heightmap samples directly as metre values.
          // Do not apply the byte-packed-height multiplier to this typed array.
          heights[row * TERRAIN_TILE_SIZE + column] = dem.sampleElevation(
            longitude,
            latitude
          );
        }
      }
      return heights;
    },
  });
}
