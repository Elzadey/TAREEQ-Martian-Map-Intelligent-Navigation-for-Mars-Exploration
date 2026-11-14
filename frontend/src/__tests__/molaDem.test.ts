import { readFileSync } from "fs";
import path from "path";
import {
  getPlanningGridCoordinates,
  planRoutesLocal,
} from "../features/route-planning/algorithms";
import {
  createMolaTerrainProvider,
  decodeMolaDem,
  MOLA_DEM_LABEL,
} from "../features/mars-mapping/services/molaDem";

jest.mock("cesium", () => ({
  CustomHeightmapTerrainProvider: jest.fn(),
  Ellipsoid: jest.fn(),
  GeographicTilingScheme: jest.fn(() => ({
    tileXYToRectangle: () => ({
      west: -Math.PI,
      east: 0,
      north: Math.PI / 2,
      south: -Math.PI / 2,
    }),
  })),
}));

const cesiumMock = jest.requireMock("cesium") as {
  CustomHeightmapTerrainProvider: jest.Mock;
  GeographicTilingScheme: jest.Mock;
};

const loadBundledTestDem = () => {
  const bytes = readFileSync(
    path.resolve(__dirname, "../../public/data/megt90n000cb.img")
  );
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  return decodeMolaDem(buffer);
};

describe("bundled NASA MOLA MEGDR", () => {
  it("decodes the official big-endian raster and samples across the longitude seam", () => {
    const dem = loadBundledTestDem();
    const firstCell = dem.sampleElevation(0.125, 89.875);

    expect(firstCell).toBeGreaterThan(-1985);
    expect(firstCell).toBeLessThan(-1955);
    expect(dem.sampleElevation(360.125, 89.875)).toBeCloseTo(firstCell, 5);
    expect(dem.sampleElevation(-359.875, 89.875)).toBeCloseTo(firstCell, 5);
  });

  it("passes positive and negative MOLA Float32 heights to Cesium in metres", () => {
    cesiumMock.GeographicTilingScheme.mockImplementation(() => ({
      tileXYToRectangle: () => ({
        west: -Math.PI,
        east: 0,
        north: Math.PI / 2,
        south: -Math.PI / 2,
      }),
    }));
    const marsEllipsoid = {} as import("cesium").Ellipsoid;
    const positiveDem = { sampleElevation: () => 5120 };
    createMolaTerrainProvider(positiveDem, marsEllipsoid);
    const positiveCalls = cesiumMock.CustomHeightmapTerrainProvider.mock.calls;
    const positiveOptions = positiveCalls[positiveCalls.length - 1]?.[0] as {
      callback: (x: number, y: number, level: number) => Float32Array;
    };
    expect(positiveOptions.callback(0, 0, 0)[0]).toBeCloseTo(5120);

    const negativeDem = { sampleElevation: () => -3072 };
    createMolaTerrainProvider(negativeDem, marsEllipsoid);
    const negativeCalls = cesiumMock.CustomHeightmapTerrainProvider.mock.calls;
    const negativeOptions = negativeCalls[negativeCalls.length - 1]?.[0] as {
      callback: (x: number, y: number, level: number) => Float32Array;
    };
    expect(negativeOptions.callback(0, 0, 0)[0]).toBeCloseTo(-3072);
  });

  it("gives A* and Uniform-Cost distinct terrain-aware routes for the screenshot endpoints", () => {
    const dem = loadBundledTestDem();
    const start: [number, number] = [-133.8, 18.65];
    const end: [number, number] = [-59, -14];
    const samples = getPlanningGridCoordinates(start, end).map(
      ([longitude, latitude]) => dem.sampleElevation(longitude, latitude)
    );
    const result = planRoutesLocal(
      start,
      end,
      new Float64Array(samples),
      MOLA_DEM_LABEL
    );
    const astar = result.routes.find((route) => route.id === "astar");
    const uniformCost = result.routes.find((route) => route.id === "ucs");

    expect(result.terrain).toBe(MOLA_DEM_LABEL);
    expect(astar?.path).toBeDefined();
    expect(uniformCost?.path).toBeDefined();
    expect(astar?.path).not.toEqual(uniformCost?.path);
    expect(astar?.nodes_expanded).toBeLessThan(
      uniformCost?.nodes_expanded ?? 0
    );
  });
});
