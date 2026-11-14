import { readFileSync } from "fs";
import path from "path";
import {
  createJezeroOrthophotoProvider,
  createJezeroTerrainProvider,
  decodeJezeroDem,
  JEZERO_DEM_LABEL,
} from "../features/mars-mapping/services/jezeroDem";
import {
  getPlanningBounds,
  getPlanningGridCoordinates,
  planRoutesLocal,
} from "../features/route-planning/algorithms";

jest.mock("cesium", () => {
  const state = {
    tileRectangle: {
      west: 0,
      south: 0,
      east: 0,
      north: 0,
    },
  };
  class MockGeographicTilingScheme {
    tileXYToRectangle() {
      return state.tileRectangle;
    }
  }
  return {
    CustomHeightmapTerrainProvider: jest.fn((options) => ({ options })),
    Ellipsoid: jest.fn(),
    GeographicTilingScheme: MockGeographicTilingScheme,
    Rectangle: jest.fn(),
    SingleTileImageryProvider: jest.fn((options) => ({ options })),
    __testState: state,
  };
});

const cesiumMock = jest.requireMock("cesium") as {
  CustomHeightmapTerrainProvider: jest.Mock;
  Rectangle: jest.Mock;
  SingleTileImageryProvider: jest.Mock;
  __testState: {
    tileRectangle: { west: number; south: number; east: number; north: number };
  };
};

function loadVerifiedJezeroDem() {
  const root = path.resolve(__dirname, "../../public/data/jezero");
  const data = readFileSync(path.join(root, "jezero-ctx-dem-f32le.bin"));
  const metadata = JSON.parse(
    readFileSync(path.join(root, "jezero-ctx-metadata.json"), "utf8")
  ) as Parameters<typeof decodeJezeroDem>[1];
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  );
  return { dem: decodeJezeroDem(buffer, metadata), metadata };
}

describe("verified Jezero CTX terrain pair", () => {
  beforeEach(() => {
    cesiumMock.CustomHeightmapTerrainProvider.mockClear();
    cesiumMock.Rectangle.mockClear();
    cesiumMock.SingleTileImageryProvider.mockClear();
  });

  it("samples actual 20 m DTM values while retaining app coordinates and verifying the footprint", () => {
    const { dem, metadata } = loadVerifiedJezeroDem();
    const center: [number, number] = [
      (dem.bounds.west + dem.bounds.east) / 2,
      (dem.bounds.south + dem.bounds.north) / 2,
    ];
    const elevation = dem.sampleElevation(center[0], center[1]);

    expect(dem.label).toBe(JEZERO_DEM_LABEL);
    expect(dem.resolutionMeters).toBe(20);
    expect(dem.bounds.south).toBeGreaterThan(metadata.dem.boundsDegrees.south);
    expect(elevation).not.toBeNull();
    expect(elevation).toBeGreaterThanOrEqual(
      metadata.dem.validElevationMinMeters
    );
    expect(elevation).toBeLessThanOrEqual(metadata.dem.validElevationMaxMeters);
    expect(
      dem.coversPath([
        [center[0] - 0.025, center[1] - 0.01],
        [center[0] + 0.025, center[1] + 0.01],
      ])
    ).toBe(true);
    expect(
      dem.coversPath([
        [dem.bounds.east + 0.1, center[1]],
        [dem.bounds.east + 0.2, center[1]],
      ])
    ).toBe(false);
    expect(dem.sampleElevation(dem.bounds.east + 0.1, center[1])).toBeNull();
    expect(
      dem.sampleElevation(dem.bounds.west + 0.01, dem.bounds.south)
    ).not.toBeNull();
  });

  it("builds terrain tiles from the regional DTM and matching georeferenced orthophoto", () => {
    const { dem } = loadVerifiedJezeroDem();
    const ellipsoid = {} as import("cesium").Ellipsoid;
    const latitude = (dem.bounds.south + dem.bounds.north) / 2;
    const longitude = (dem.bounds.west + dem.bounds.east) / 2;
    const halfSpan = 0.005;
    cesiumMock.__testState.tileRectangle = {
      west: ((longitude - halfSpan) * Math.PI) / 180,
      south: ((latitude - halfSpan) * Math.PI) / 180,
      east: ((longitude + halfSpan) * Math.PI) / 180,
      north: ((latitude + halfSpan) * Math.PI) / 180,
    };

    const provider = createJezeroTerrainProvider(dem, ellipsoid);
    const terrainOptions = cesiumMock.CustomHeightmapTerrainProvider.mock
      .calls[0][0] as {
      callback: (x: number, y: number, level: number) => Float32Array;
      height: number;
    };
    const heights = terrainOptions.callback(0, 0, 0);
    const expected = dem.sampleElevation(longitude, latitude);

    expect(terrainOptions.height).toBe(65);
    expect(heights[32 * 65 + 32]).toBeCloseTo(expected ?? 0, 1);
    expect(provider).toBeDefined();

    createJezeroOrthophotoProvider(dem, ellipsoid, "/app");
    const imageryOptions = cesiumMock.SingleTileImageryProvider.mock
      .calls[0][0] as {
      url: string;
      tileWidth: number;
      tileHeight: number;
      ellipsoid: unknown;
    };
    const rectangleArguments = cesiumMock.Rectangle.mock.calls[0] as number[];
    expect(imageryOptions.url).toBe(
      "/app/data/jezero/jezero-ctx-orthophoto.png"
    );
    expect(imageryOptions.tileWidth).toBe(dem.orthophotoWidth);
    expect(imageryOptions.tileHeight).toBe(dem.orthophotoHeight);
    expect(imageryOptions.ellipsoid).toBe(ellipsoid);
    expect(rectangleArguments[1]).toBeCloseTo(
      (dem.orthophotoBounds.south * Math.PI) / 180,
      8
    );
    expect(rectangleArguments[3]).toBeCloseTo(
      (dem.orthophotoBounds.north * Math.PI) / 180,
      8
    );
  });

  it("leaves source CTX samples unchanged when no vertical datum model is supplied", () => {
    const { dem } = loadVerifiedJezeroDem();
    const ellipsoid = {} as import("cesium").Ellipsoid;
    const latitude = (dem.bounds.south + dem.bounds.north) / 2;
    const longitude = (dem.bounds.west + dem.bounds.east) / 2;
    const halfSpan = 0.005;
    cesiumMock.__testState.tileRectangle = {
      west: ((longitude - halfSpan) * Math.PI) / 180,
      south: ((latitude - halfSpan) * Math.PI) / 180,
      east: ((longitude + halfSpan) * Math.PI) / 180,
      north: ((latitude + halfSpan) * Math.PI) / 180,
    };

    createJezeroTerrainProvider(dem, ellipsoid);
    const options = cesiumMock.CustomHeightmapTerrainProvider.mock
      .calls[0][0] as {
      callback: (x: number, y: number, level: number) => Float32Array;
    };
    const sourceElevation = dem.sampleElevation(longitude, latitude);
    const renderedHeights = options.callback(0, 0, 0);

    expect(renderedHeights[32 * 65 + 32]).toBeCloseTo(
      sourceElevation ?? 0,
      1
    );
    expect(dem.sampleElevation(longitude, latitude)).toBeCloseTo(
      sourceElevation ?? 0,
      1
    );
  });

  it("converts CTX areoid heights for the Cesium mesh and applies a render-only origin", () => {
    const { dem } = loadVerifiedJezeroDem();
    const ellipsoid = {} as import("cesium").Ellipsoid;
    const latitude = (dem.bounds.south + dem.bounds.north) / 2;
    const longitude = (dem.bounds.west + dem.bounds.east) / 2;
    const halfSpan = 0.005;
    cesiumMock.__testState.tileRectangle = {
      west: ((longitude - halfSpan) * Math.PI) / 180,
      south: ((latitude - halfSpan) * Math.PI) / 180,
      east: ((longitude + halfSpan) * Math.PI) / 180,
      north: ((latitude + halfSpan) * Math.PI) / 180,
    };
    const verticalDatum = {
      sampleElevation: jest.fn(() => 0),
      ellipsoidHeightFromAreoidElevation: jest.fn(
        (_longitude: number, _latitude: number, elevation: number) =>
          elevation + 327
      ),
    };

    createJezeroTerrainProvider(dem, ellipsoid, verticalDatum, 2_580);
    const options = cesiumMock.CustomHeightmapTerrainProvider.mock
      .calls[0][0] as {
      callback: (x: number, y: number, level: number) => Float32Array;
    };
    const sourceElevation = dem.sampleElevation(longitude, latitude) ?? 0;
    const renderedHeights = options.callback(0, 0, 0);

    expect(renderedHeights[32 * 65 + 32]).toBeCloseTo(
      sourceElevation + 327 + 2_580,
      1
    );
    expect(dem.sampleElevation(longitude, latitude)).toBeCloseTo(
      sourceElevation,
      1
    );
    const centerDatumCall =
      verticalDatum.ellipsoidHeightFromAreoidElevation.mock.calls.find(
        ([sampleLongitude, sampleLatitude]) =>
          Math.abs(sampleLongitude - longitude) < 1e-9 &&
          Math.abs(sampleLatitude - latitude) < 1e-9
      );
    expect(centerDatumCall).toBeDefined();
    expect(centerDatumCall?.[2]).toBeCloseTo(sourceElevation, 1);
  });

  it("plans within the actual regional footprint using the decoded CTX heights", () => {
    const { dem } = loadVerifiedJezeroDem();
    const start: [number, number] = [77.45, 18.44];
    const end: [number, number] = [77.5497, 18.6658];
    expect(dem.coversPath([start, end])).toBe(true);
    const planningBounds = getPlanningBounds(start, end, dem.bounds);
    const coordinates = getPlanningGridCoordinates(start, end, planningBounds);
    const samples = coordinates.map(([longitude, latitude]) =>
      dem.sampleElevation(longitude, latitude)
    );

    expect(samples.every((height) => height !== null)).toBe(true);
    const plan = planRoutesLocal(
      start,
      end,
      new Float64Array(samples as number[]),
      JEZERO_DEM_LABEL,
      planningBounds
    );
    expect(plan.terrain).toBe(JEZERO_DEM_LABEL);
    expect(
      plan.routes.every((route) => Boolean(route.path || route.error))
    ).toBe(true);
    expect(() =>
      getPlanningGridCoordinates(start, end, {
        west: dem.bounds.east + 1,
        east: dem.bounds.east + 2,
        south: dem.bounds.south,
        north: dem.bounds.north,
      })
    ).toThrow(/inside the selected DEM coverage/i);
  });
});
