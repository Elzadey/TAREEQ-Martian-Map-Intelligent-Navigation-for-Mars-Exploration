import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  publishActiveRoute,
  publishMissionRouteState,
} from "../features/route-planning/routeOverlayBus";
import Mars3DViewer from "../views/Mars3DViewer";

jest.mock("cesium", () => {
  const addedLayers: Array<{ show: boolean; alpha: number }> = [];
  const cameraController = {
    enableInputs: false,
    enableZoom: false,
    inertiaZoom: 0,
  };
  const mockViewer = {
    scene: {
      renderError: { addEventListener: jest.fn() },
      screenSpaceCameraController: cameraController,
      globe: {
        baseColor: null,
        show: true,
        showGroundAtmosphere: false,
        getHeight: jest.fn(() => 0),
      },
      skyBox: { show: true },
      skyAtmosphere: { show: true },
      backgroundColor: null,
    },
    canvas: { style: {} },
    imageryLayers: {
      addImageryProvider: jest.fn(() => {
        const layer = { show: true, alpha: 1 };
        addedLayers.push(layer);
        return layer;
      }),
      remove: jest.fn(),
    },
    entities: {
      add: jest.fn(() => ({})),
      removeById: jest.fn(),
    },
    camera: {
      setView: jest.fn(),
      lookAt: jest.fn(),
      lookAtTransform: jest.fn(),
      positionCartographic: { height: 5_000_000 },
      zoomIn: jest.fn(),
      zoomOut: jest.fn(),
    },
    destroy: jest.fn(),
  };

  return {
    Cartesian2: jest.fn(),
    Cartesian3: Object.assign(
      jest.fn((x = 0, y = 0, z = 0) => ({ x, y, z })),
      {
        fromDegrees: jest.fn((x, y, z) => ({ x, y, z })),
        fromDegreesArray: jest.fn(() => ["Mars route positions"]),
        fromDegreesArrayHeights: jest.fn(() => ["Mars 3D route positions"]),
      }
    ),
    Cartographic: Object.assign(jest.fn(), {
      fromDegrees: jest.fn(() => "Mars surface position"),
    }),
    Color: Object.assign(jest.fn(), {
      fromCssColorString: jest.fn(() => "route color"),
      YELLOW: "yellow",
    }),
    CesiumTerrainProvider: { fromUrl: jest.fn() },
    ConstantPositionProperty: jest.fn((value) => value),
    ConstantProperty: jest.fn((value) => value),
    Credit: jest.fn(),
    Ellipsoid: jest.fn(),
    GeographicProjection: jest.fn(),
    Globe: jest.fn(),
    HeadingPitchRange: jest.fn((heading, pitch, range) => ({
      heading,
      pitch,
      range,
    })),
    HeightReference: { RELATIVE_TO_GROUND: 2 },
    ImageryLayer: jest.fn(),
    SkyAtmosphere: jest.fn(),
    Transforms: {
      eastNorthUpToFixedFrame: jest.fn(() => "Mars ENU frame"),
      headingPitchRollQuaternion: jest.fn(() => "Mars rover orientation"),
    },
    UrlTemplateImageryProvider: jest.fn(),
    WebMapServiceImageryProvider: jest.fn(),
    Viewer: jest.fn(() => mockViewer),
    GeographicTilingScheme: jest.fn(),
    WebMercatorTilingScheme: jest.fn(),
    __testState: { addedLayers, cameraController, mockViewer },
  };
});

jest.mock("../features/mars-mapping/services/molaDem", () => ({
  MOLA_DEM_LABEL: "NASA MOLA MEGDR · 4 ppd",
  loadMolaDem: jest.fn(() =>
    Promise.resolve({ sampleElevation: jest.fn(() => -1000) })
  ),
  createMolaTerrainProvider: jest.fn(() => ({
    bundledMolaTerrain: true,
    errorEvent: { addEventListener: jest.fn() },
  })),
}));

jest.mock("../features/mars-mapping/services/jezeroDem", () => ({
  JEZERO_DEM_LABEL: "NASA/USGS CTX Jezero DTM · 20 m",
  JEZERO_ORTHO_LABEL: "NASA/USGS CTX Jezero orthophoto · 6 m",
  loadJezeroDem: jest.fn(() =>
    Promise.resolve({
      label: "NASA/USGS CTX Jezero DTM · 20 m",
      bounds: { west: 77.1, south: 18.3, east: 77.8, north: 18.9 },
      orthophotoBounds: { west: 77.1, south: 18.3, east: 77.8, north: 18.9 },
      width: 1596,
      height: 1512,
      resolutionMeters: 20,
      marsRadiusMeters: 3396190,
      elevationReference: "MOLA delta geoid",
      sampleElevation: jest.fn(() => -2300),
      coversPath: jest.fn(() => true),
    })
  ),
  createJezeroTerrainProvider: jest.fn(() => ({ jezeroTerrain: true })),
  createJezeroOrthophotoProvider: jest.fn(() => ({ jezeroImagery: true })),
}));

const cesiumMock = jest.requireMock("cesium") as {
  Cartesian3: jest.Mock & {
    fromDegrees: jest.Mock;
    fromDegreesArray: jest.Mock;
    fromDegreesArrayHeights: jest.Mock;
  };
  Color: jest.Mock & { fromCssColorString: jest.Mock };
  Ellipsoid: jest.Mock;
  GeographicProjection: jest.Mock;
  GeographicTilingScheme: jest.Mock;
  Globe: jest.Mock;
  HeadingPitchRange: jest.Mock;
  Transforms: { eastNorthUpToFixedFrame: jest.Mock };
  UrlTemplateImageryProvider: jest.Mock;
  WebMercatorTilingScheme: jest.Mock;
  Viewer: jest.Mock;
  __testState: {
    addedLayers: Array<{ show: boolean; alpha: number }>;
    cameraController: {
      enableInputs: boolean;
      enableZoom: boolean;
      inertiaZoom: number;
    };
    mockViewer: {
      canvas: { style: { touchAction?: string } };
      imageryLayers: {
        addImageryProvider: jest.Mock;
        remove: jest.Mock;
      };
      entities: {
        add: jest.Mock;
        removeById: jest.Mock;
      };
      camera: {
        setView: jest.Mock;
        lookAt: jest.Mock;
        lookAtTransform: jest.Mock;
        zoomIn: jest.Mock;
        zoomOut: jest.Mock;
      };
      scene: {
        screenSpaceCameraController: object;
        skyBox: { show: boolean } | undefined;
        skyAtmosphere: { show: boolean } | undefined;
        backgroundColor: unknown;
        globe: {
          baseColor: unknown;
          show: boolean;
          showGroundAtmosphere: boolean;
          getHeight: jest.Mock;
        };
      };
    };
  };
};

const molaDemMock = jest.requireMock(
  "../features/mars-mapping/services/molaDem"
) as {
  loadMolaDem: jest.Mock;
  createMolaTerrainProvider: jest.Mock;
};

const jezeroDemMock = jest.requireMock(
  "../features/mars-mapping/services/jezeroDem"
) as {
  JEZERO_DEM_LABEL: string;
  loadJezeroDem: jest.Mock;
  createJezeroTerrainProvider: jest.Mock;
  createJezeroOrthophotoProvider: jest.Mock;
};

describe("Mars3DViewer", () => {
  beforeEach(() => {
    const { addedLayers, cameraController, mockViewer } =
      cesiumMock.__testState;
    addedLayers.length = 0;
    publishActiveRoute(null);
    publishMissionRouteState(null);
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as typeof fetch;
    cameraController.enableInputs = false;
    cameraController.enableZoom = false;
    cameraController.inertiaZoom = 0;
    mockViewer.scene.globe.show = true;
    mockViewer.camera.setView.mockClear();
    mockViewer.camera.lookAtTransform.mockClear();
    mockViewer.entities.add.mockClear();
    cesiumMock.Cartesian3.fromDegrees.mockClear();
    mockViewer.imageryLayers.addImageryProvider.mockImplementation(() => {
      const layer = { show: true, alpha: 1 };
      addedLayers.push(layer);
      return layer;
    });
    cesiumMock.Viewer.mockImplementation(() => mockViewer);
    cesiumMock.Cartesian3.mockImplementation((x = 0, y = 0, z = 0) => ({
      x,
      y,
      z,
    }));
    cesiumMock.Cartesian3.fromDegrees.mockImplementation((x, y, z) => ({
      x,
      y,
      z,
    }));
    cesiumMock.Cartesian3.fromDegreesArray.mockReturnValue([
      "Mars route positions",
    ]);
    cesiumMock.Cartesian3.fromDegreesArrayHeights.mockClear();
    cesiumMock.Cartesian3.fromDegreesArrayHeights.mockReturnValue([
      "Mars 3D route positions",
    ]);
    cesiumMock.Color.fromCssColorString.mockReturnValue("route color");
    cesiumMock.HeadingPitchRange.mockImplementation(
      (heading, pitch, range) => ({ heading, pitch, range })
    );
    cesiumMock.Transforms.eastNorthUpToFixedFrame.mockClear();
    cesiumMock.Transforms.eastNorthUpToFixedFrame.mockReturnValue(
      "Mars ENU frame"
    );
    cesiumMock.GeographicTilingScheme.mockClear();
    cesiumMock.GeographicProjection.mockClear();
    cesiumMock.WebMercatorTilingScheme.mockClear();
    cesiumMock.UrlTemplateImageryProvider.mockClear();
    molaDemMock.loadMolaDem.mockImplementation(
      () => new Promise(() => undefined)
    );
    molaDemMock.createMolaTerrainProvider.mockReturnValue({
      bundledMolaTerrain: true,
      errorEvent: { addEventListener: jest.fn() },
    });
    jezeroDemMock.loadJezeroDem.mockImplementation(
      () => new Promise(() => undefined)
    );
    jezeroDemMock.createJezeroTerrainProvider.mockClear();
    jezeroDemMock.createJezeroTerrainProvider.mockReturnValue({
      jezeroTerrain: true,
    });
    jezeroDemMock.createJezeroOrthophotoProvider.mockClear();
    jezeroDemMock.createJezeroOrthophotoProvider.mockReturnValue({
      jezeroImagery: true,
    });
  });

  it("uses Mars dimensions and keeps wheel, pinch, and NASA imagery controls enabled", async () => {
    molaDemMock.loadMolaDem.mockResolvedValue({
      sampleElevation: jest.fn(() => -1000),
    });
    render(<Mars3DViewer />);
    await screen.findByText(/Terrain: NASA MOLA MEGDR/);

    expect(cesiumMock.Globe).toHaveBeenCalledWith(expect.anything());
    expect(cesiumMock.Ellipsoid).toHaveBeenCalledWith(
      3396190,
      3396190,
      3376200
    );
    expect(cesiumMock.Viewer).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({
        baseLayer: false,
        ellipsoid: expect.anything(),
        globe: expect.anything(),
        mapProjection: expect.anything(),
      })
    );
    expect(cesiumMock.GeographicProjection).toHaveBeenCalledWith(
      expect.anything()
    );
    expect(cesiumMock.UrlTemplateImageryProvider).toHaveBeenCalledWith(
      expect.objectContaining({ maximumLevel: 7 })
    );
    expect(cesiumMock.UrlTemplateImageryProvider).toHaveBeenCalledWith(
      expect.objectContaining({ maximumLevel: 9 })
    );
    expect(cesiumMock.__testState.cameraController).toEqual({
      enableInputs: true,
      enableZoom: true,
      inertiaZoom: 0.8,
    });
    expect(cesiumMock.__testState.mockViewer.canvas.style.touchAction).toBe(
      "none"
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(
      cesiumMock.__testState.mockViewer.camera.zoomIn
    ).toHaveBeenCalledWith(1_000_000);
    expect(
      cesiumMock.__testState.mockViewer.camera.zoomOut
    ).toHaveBeenCalledWith(1_000_000);
    expect(screen.getByText(/Terrain: NASA MOLA MEGDR/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /USGS-NASA geology WMS/i })
    ).toBeDisabled();

    const molaLayer = cesiumMock.__testState.addedLayers[1];
    expect(molaLayer.show).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /MOLA colorized hillshade/i })
    );
    expect(molaLayer.show).toBe(false);

    publishActiveRoute({
      path: [
        [0, 0],
        [1, 1],
      ],
      color: "#22c55e",
    });
    expect(cesiumMock.__testState.mockViewer.entities.add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tareeq-active-route",
        polyline: expect.objectContaining({ clampToGround: true }),
      })
    );
  });

  it("uses a geographic tiling scheme for NASA Mars EQ imagery", () => {
    render(<Mars3DViewer />);

    expect(cesiumMock.GeographicTilingScheme).toHaveBeenCalledWith({
      ellipsoid: expect.anything(),
    });
    const geographicScheme =
      cesiumMock.GeographicTilingScheme.mock.instances[0];
    const nasaProviders = cesiumMock.UrlTemplateImageryProvider.mock.calls
      .map(([options]) => options as { url: string; tilingScheme: unknown })
      .filter((options) => options.url.includes("/Mars/EQ/"));

    expect(nasaProviders).toHaveLength(3);
    nasaProviders.forEach((options) =>
      expect(options.tilingScheme).toBe(geographicScheme)
    );
  });

  it("keeps the planet view hidden while regional terrain is loading", async () => {
    const { mockViewer } = cesiumMock.__testState;
    render(<Mars3DViewer missionMode />);

    act(() => {
      publishMissionRouteState({
        path: [
          [0, 0],
          [0.1, 0.1],
        ],
        color: "#22c55e",
        name: "Uniform-Cost Search",
        algorithm: "Uniform-Cost Search",
        algorithmId: "ucs",
        start: [0, 0],
        end: [0.1, 0.1],
        distanceKm: 15,
        durationHours: 100,
        terrainSource: "NASA MOLA MEGDR · 4 ppd",
      });
    });

    expect(screen.getByText("Regional mission view")).toBeInTheDocument();
    expect(screen.getByText(/Loading local terrain/)).toBeInTheDocument();
    expect(mockViewer.camera.setView).not.toHaveBeenCalled();
    expect(mockViewer.scene.globe.show).toBe(false);
    expect(
      screen.getByRole("img", { name: "Mission route overview" })
    ).toBeInTheDocument();
  });

  it("starts in a regional chase view with the NASA Curiosity model and route map", async () => {
    const { mockViewer } = cesiumMock.__testState;
    const regionalDem = {
      label: jezeroDemMock.JEZERO_DEM_LABEL,
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
      sampleElevation: jest.fn(() => -2300),
      coversPath: jest.fn(() => true),
    };
    jezeroDemMock.loadJezeroDem.mockResolvedValue(regionalDem);
    render(<Mars3DViewer missionMode />);

    await act(async () => {
      publishMissionRouteState({
        path: [
          [77.25, 18.42],
          [77.48, 18.55],
        ],
        color: "#22c55e",
        name: "Uniform-Cost Search",
        algorithm: "Uniform-Cost Search",
        algorithmId: "ucs",
        start: [77.25, 18.42],
        end: [77.48, 18.55],
        distanceKm: 15,
        durationHours: 100,
        terrainSource: "NASA MOLA MEGDR · 4 ppd",
      });
      await Promise.resolve();
    });

    expect(screen.getByText("Rover moving")).toBeInTheDocument();
    expect(screen.queryByText("Regional mission view")).not.toBeInTheDocument();
    expect(mockViewer.scene.skyBox).toBeUndefined();
    expect(mockViewer.scene.skyAtmosphere).toBeUndefined();
    expect(mockViewer.scene.globe.showGroundAtmosphere).toBe(false);
    expect(mockViewer.scene.globe.show).toBe(true);
    expect(jezeroDemMock.createJezeroTerrainProvider).toHaveBeenCalledWith(
      regionalDem,
      expect.anything(),
      null,
      4_000
    );
    expect(jezeroDemMock.createJezeroOrthophotoProvider).toHaveBeenCalledWith(
      regionalDem,
      expect.anything()
    );
    expect(cesiumMock.Cartesian3.fromDegreesArray).toHaveBeenCalled();
    const routeEntity = mockViewer.entities.add.mock.calls
      .map(
        ([entity]) =>
          entity as { id: string; polyline?: { clampToGround: boolean } }
      )
      .find((entity) => entity.id === "tareeq-active-route");
    expect(routeEntity?.polyline?.clampToGround).toBe(true);
    const roverEntity = mockViewer.entities.add.mock.calls
      .map(
        ([entity]) =>
          entity as {
            id: string;
            model?: {
              uri: string;
              minimumPixelSize: number;
            };
          }
      )
      .find((entity) => entity.id === "tareeq-rover");
    expect(roverEntity?.model?.uri).toContain("models/curiosity.glb");
    expect(roverEntity?.model?.minimumPixelSize).toBe(96);
    expect(cesiumMock.Cartesian3.fromDegrees).toHaveBeenCalledWith(
      77.25,
      18.42,
      1_705,
      expect.anything()
    );
    const cameraCalls = mockViewer.camera.setView.mock.calls;
    const chaseView = cameraCalls[cameraCalls.length - 1]?.[0] as {
      destination?: { x: number; y: number; z: number };
      orientation?: {
        direction: { x: number; y: number; z: number };
        up: { x: number; y: number; z: number };
      };
    };
    expect(chaseView.destination).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });
    expect(chaseView.orientation?.direction).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });
    expect(chaseView.orientation?.up).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });
    expect(screen.getByText(/NASA\/USGS CTX Jezero DTM/)).toBeInTheDocument();
  });

  it("falls back transparently outside Jezero instead of using its unrelated local raster", async () => {
    const { mockViewer } = cesiumMock.__testState;
    molaDemMock.loadMolaDem.mockResolvedValue({
      sampleElevation: jest.fn(() => -1000),
    });
    jezeroDemMock.loadJezeroDem.mockResolvedValue({
      label: jezeroDemMock.JEZERO_DEM_LABEL,
      bounds: { west: 77.1, south: 18.3, east: 77.8, north: 18.9 },
      orthophotoBounds: {
        west: 77.1,
        south: 18.3,
        east: 77.8,
        north: 18.9,
      },
      width: 1596,
      height: 1512,
      resolutionMeters: 20,
      marsRadiusMeters: 3396190,
      elevationReference: "MOLA delta geoid",
      sampleElevation: jest.fn(() => -2300),
      coversPath: jest.fn(() => false),
    });
    render(<Mars3DViewer missionMode />);

    await act(async () => {
      publishMissionRouteState({
        path: [
          [0, 0],
          [0.1, 0.1],
        ],
        color: "#22c55e",
        name: "Uniform-Cost Search",
        algorithm: "Uniform-Cost Search",
        algorithmId: "ucs",
        start: [0, 0],
        end: [0.1, 0.1],
        distanceKm: 15,
        durationHours: 100,
        terrainSource: "NASA MOLA MEGDR · 4 ppd",
      });
      await Promise.resolve();
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      /outside the verified Jezero CTX footprint/i
    );
    expect(
      screen.getByRole("link", { name: "USGS HRSC–MOLA global DEM" })
    ).toBeInTheDocument();
    expect(jezeroDemMock.createJezeroTerrainProvider).not.toHaveBeenCalled();
    expect(jezeroDemMock.createJezeroOrthophotoProvider).not.toHaveBeenCalled();
    expect(mockViewer.scene.globe.show).toBe(true);
  });
});
