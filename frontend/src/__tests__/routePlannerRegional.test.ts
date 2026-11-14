import { planRoutes } from "../features/mars-mapping/services/routePlanner";
import {
  loadJezeroDem,
  JEZERO_DEM_LABEL,
} from "../features/mars-mapping/services/jezeroDem";
import {
  loadMolaDem,
  MOLA_DEM_LABEL,
} from "../features/mars-mapping/services/molaDem";

jest.mock("cesium", () => ({
  Cartographic: { fromDegrees: jest.fn() },
  CesiumTerrainProvider: { fromUrl: jest.fn() },
  Ellipsoid: jest.fn(),
  sampleTerrainMostDetailed: jest.fn(),
}));

jest.mock("../features/mars-mapping/services/jezeroDem", () => ({
  JEZERO_DEM_LABEL: "NASA/USGS CTX Jezero DTM · 20 m",
  loadJezeroDem: jest.fn(),
}));

jest.mock("../features/mars-mapping/services/molaDem", () => ({
  MOLA_DEM_LABEL: "NASA MOLA MEGDR · 4 ppd",
  loadMolaDem: jest.fn(),
}));

const jezeroLoader = loadJezeroDem as jest.MockedFunction<typeof loadJezeroDem>;
const molaLoader = loadMolaDem as jest.MockedFunction<typeof loadMolaDem>;

function makeRegionalDem(covered: boolean) {
  return {
    label: JEZERO_DEM_LABEL,
    bounds: { west: 77.1, south: 18.3, east: 77.8, north: 18.9 },
    orthophotoBounds: {
      west: 77.1,
      south: 18.3,
      east: 77.8,
      north: 18.9,
    },
    orthophotoWidth: 5322,
    orthophotoHeight: 5040,
    width: 1596,
    height: 1512,
    resolutionMeters: 20,
    marsRadiusMeters: 3396190,
    elevationReference: "MOLA delta geoid",
    sampleElevation: (longitude: number, latitude: number) =>
      -2300 + (longitude - 77.4) * 20 + (latitude - 18.6) * 10,
    coversPath: () => covered,
  };
}

describe("regional route DEM selection", () => {
  const originalTerrainUrl = process.env.REACT_APP_MARS_TERRAIN_URL;

  beforeEach(() => {
    delete process.env.REACT_APP_MARS_TERRAIN_URL;
    jezeroLoader.mockResolvedValue(makeRegionalDem(true));
    molaLoader.mockResolvedValue({
      sampleElevation: () => -1000,
    } as Awaited<ReturnType<typeof loadMolaDem>>);
  });

  afterAll(() => {
    if (originalTerrainUrl === undefined) {
      delete process.env.REACT_APP_MARS_TERRAIN_URL;
    } else {
      process.env.REACT_APP_MARS_TERRAIN_URL = originalTerrainUrl;
    }
  });

  it("uses the real high-resolution regional source when both endpoints and grid are covered", async () => {
    const plan = await planRoutes([77.25, 18.42], [77.48, 18.55]);

    expect(plan.terrain).toBe(JEZERO_DEM_LABEL);
    expect(plan.routes).toHaveLength(3);
    expect(molaLoader).not.toHaveBeenCalled();
  });

  it("never extrapolates Jezero into another site and falls back to bundled global MOLA", async () => {
    jezeroLoader.mockResolvedValue(makeRegionalDem(false));

    const plan = await planRoutes([0, 0], [0.1, 0.1]);

    expect(plan.terrain).toBe(MOLA_DEM_LABEL);
    expect(plan.routes).toHaveLength(3);
    expect(molaLoader).toHaveBeenCalledTimes(1);
  });
});
