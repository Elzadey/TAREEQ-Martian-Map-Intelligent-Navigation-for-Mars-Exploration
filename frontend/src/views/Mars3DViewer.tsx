import {
  Cartesian3,
  Cartesian2,
  Cartographic,
  CesiumTerrainProvider,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  Credit,
  Ellipsoid,
  GeographicProjection,
  GeographicTilingScheme,
  Globe,
  HeadingPitchRoll,
  ImageryLayer,
  Transforms,
  UrlTemplateImageryProvider,
  Viewer,
  WebMapServiceImageryProvider,
  WebMercatorTilingScheme,
  SkyAtmosphere,
} from "cesium";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Pause,
  Play,
  Square,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  subscribeToActiveRoute,
  subscribeToMissionRouteState,
  type MissionRouteState,
} from "../features/route-planning/routeOverlayBus";
import type { LonLat } from "../features/route-planning/algorithms";
import {
  createMolaTerrainProvider,
  loadMolaDem,
  MOLA_AREOID_LABEL,
  MOLA_DEM_LABEL,
  type MolaDem,
} from "../features/mars-mapping/services/molaDem";
import {
  createJezeroOrthophotoProvider,
  createJezeroTerrainProvider,
  JEZERO_DEM_LABEL,
  JEZERO_ORTHO_LABEL,
  loadJezeroDem,
  type JezeroDem,
} from "../features/mars-mapping/services/jezeroDem";
import MissionRouteMiniMap from "./MissionRouteMiniMap";

type MarsLayerId = "mola" | "themisDay" | "geology";

interface MarsLayerState {
  visible: boolean;
  opacity: number;
}

const MARS_LAYER_DEFAULTS: Record<MarsLayerId, MarsLayerState> = {
  mola: { visible: true, opacity: 0.9 },
  themisDay: { visible: false, opacity: 0.7 },
  geology: { visible: false, opacity: 0.7 },
};

interface Mars3DViewerProps {
  missionMode?: boolean;
  onExitMission?: () => void;
}

const marsDistanceKm = (a: LonLat, b: LonLat): number => {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const deltaLat = toRad(b[1] - a[1]);
  const deltaLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * 3396.19 * Math.asin(Math.min(1, Math.sqrt(h)));
};

const routeDistanceKm = (path: LonLat[]): number =>
  path
    .slice(1)
    .reduce(
      (total, point, index) => total + marsDistanceKm(path[index], point),
      0
    );

const coordinateLabel = (point: LonLat): string =>
  `${point[1].toFixed(2)}°, ${point[0].toFixed(2)}°`;
const REGIONAL_CAMERA_CLEARANCE_M = 80;
const REGIONAL_CAMERA_TRAIL_M = 180;
const GLOBAL_CAMERA_CLEARANCE_M = 4_000;
const GLOBAL_CAMERA_TRAIL_M = 6_500;
const MISSION_LOCAL_SURFACE_REFERENCE_M = 300;
const ROVER_SURFACE_CLEARANCE_M = 0.25;
const WAYPOINT_MARKER_CLEARANCE_M = 1.5;
const MISSION_ROUTE_DISPLAY_CLEARANCE_M = 20;

const pointAlongRoute = (path: LonLat[], fraction: number): LonLat => {
  if (path.length < 2) return path[0] ?? [0, 0];
  const segmentLengths = path
    .slice(1)
    .map((point, index) => marsDistanceKm(path[index], point));
  const total = segmentLengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * Math.max(0, Math.min(1, fraction));
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (remaining <= segmentLength || index === segmentLengths.length - 1) {
      const start = path[index];
      const end = path[index + 1];
      const ratio = segmentLength === 0 ? 0 : remaining / segmentLength;
      return [
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ];
    }
    remaining -= segmentLength;
  }
  return path[path.length - 1];
};

const missionRenderOriginOffset = (
  path: LonLat[],
  jezeroDem: JezeroDem | null,
  molaDem: MolaDem | null
): number => {
  if (path.length === 0 || !molaDem?.ellipsoidHeightFromAreoidElevation)
    return 0;
  const ellipsoidHeights = path
    .map(([longitude, latitude]) => {
      const regionalHeight = jezeroDem?.sampleElevation(longitude, latitude);
      const sourceHeight =
        regionalHeight ?? molaDem?.sampleElevation(longitude, latitude);
      if (sourceHeight === null || sourceHeight === undefined) return null;
      return (
        molaDem?.ellipsoidHeightFromAreoidElevation?.(
          longitude,
          latitude,
          sourceHeight
        ) ?? sourceHeight
      );
    })
    .filter((height): height is number => height !== null && Number.isFinite(height));
  if (ellipsoidHeights.length === 0) return 0;
  return (
    MISSION_LOCAL_SURFACE_REFERENCE_M - Math.min(...ellipsoidHeights)
  );
};

const groundHeightAt = (
  viewer: Viewer,
  longitude: number,
  latitude: number,
  jezeroDem: JezeroDem | null,
  molaDem: MolaDem | null,
  preferViewerTerrain: boolean
): number => {
  const jezeroHeight = jezeroDem?.sampleElevation(longitude, latitude);
  if (
    jezeroHeight !== null &&
    jezeroHeight !== undefined &&
    Number.isFinite(jezeroHeight)
  )
    return jezeroHeight;
  const viewerHeight = viewer.scene.globe.getHeight(
    Cartographic.fromDegrees(longitude, latitude)
  );
  if (
    preferViewerTerrain &&
    viewerHeight !== undefined &&
    Number.isFinite(viewerHeight)
  )
    return viewerHeight;
  const molaHeight = molaDem?.sampleElevation(longitude, latitude);
  if (molaHeight !== undefined && Number.isFinite(molaHeight))
    return molaHeight;
  return viewerHeight !== undefined && Number.isFinite(viewerHeight)
    ? viewerHeight
    : 0;
};

const missionSurfaceHeightAt = (
  viewer: Viewer,
  longitude: number,
  latitude: number,
  jezeroDem: JezeroDem | null,
  molaDem: MolaDem | null,
  preferViewerTerrain: boolean,
  renderOriginOffsetMeters = 0
): number => {
  const viewerHeight = viewer.scene.globe.getHeight(
    Cartographic.fromDegrees(longitude, latitude)
  );
  if (
    preferViewerTerrain &&
    viewerHeight !== undefined &&
    Number.isFinite(viewerHeight)
  )
    return viewerHeight + renderOriginOffsetMeters;

  const sourceHeight = groundHeightAt(
    viewer,
    longitude,
    latitude,
    jezeroDem,
    molaDem,
    false
  );
  const ellipsoidHeight =
    molaDem?.ellipsoidHeightFromAreoidElevation?.(
      longitude,
      latitude,
      sourceHeight
    ) ?? sourceHeight;
  return ellipsoidHeight + renderOriginOffsetMeters;
};

const routeHeading = (start: LonLat, next: LonLat): number =>
  Math.atan2(
    (next[0] - start[0]) * Math.cos((start[1] * Math.PI) / 180),
    next[1] - start[1]
  );

const placeMissionCamera = (
  viewer: Viewer,
  point: LonLat,
  heading: number,
  jezeroDem: JezeroDem | null,
  molaDem: MolaDem | null,
  preferViewerTerrain: boolean,
  ellipsoid: Ellipsoid,
  cameraAngle = 0,
  renderOriginOffsetMeters = 0
): void => {
  const surfaceHeight =
    missionSurfaceHeightAt(
      viewer,
      point[0],
      point[1],
      jezeroDem,
      molaDem,
      preferViewerTerrain,
      renderOriginOffsetMeters
    ) + 1.5;
  const target = Cartesian3.fromDegrees(
    point[0],
    point[1],
    surfaceHeight,
    ellipsoid
  );
  const longitude = (point[0] * Math.PI) / 180;
  const latitude = (point[1] * Math.PI) / 180;
  const headingWithOffset = heading + cameraAngle;
  const upX = Math.cos(latitude) * Math.cos(longitude);
  const upY = Math.cos(latitude) * Math.sin(longitude);
  const upZ = Math.sin(latitude);
  const eastX = -Math.sin(longitude);
  const eastY = Math.cos(longitude);
  const northX = -Math.sin(latitude) * Math.cos(longitude);
  const northY = -Math.sin(latitude) * Math.sin(longitude);
  const northZ = Math.cos(latitude);
  const forwardX =
    eastX * Math.sin(headingWithOffset) + northX * Math.cos(headingWithOffset);
  const forwardY =
    eastY * Math.sin(headingWithOffset) + northY * Math.cos(headingWithOffset);
  const forwardZ = northZ * Math.cos(headingWithOffset);
  const clearance = jezeroDem
    ? REGIONAL_CAMERA_CLEARANCE_M
    : GLOBAL_CAMERA_CLEARANCE_M;
  const trail = jezeroDem ? REGIONAL_CAMERA_TRAIL_M : GLOBAL_CAMERA_TRAIL_M;
  const destination = new Cartesian3(
    target.x - forwardX * trail + upX * clearance,
    target.y - forwardY * trail + upY * clearance,
    target.z - forwardZ * trail + upZ * clearance
  );
  const directionX = target.x - destination.x;
  const directionY = target.y - destination.y;
  const directionZ = target.z - destination.z;
  const directionLength = Math.hypot(directionX, directionY, directionZ);
  viewer.camera.setView({
    destination,
    orientation: {
      direction: new Cartesian3(
        directionX / directionLength,
        directionY / directionLength,
        directionZ / directionLength
      ),
      up: new Cartesian3(upX, upY, upZ),
    },
  });
};

const Mars3DViewer: React.FC<Mars3DViewerProps> = ({
  missionMode = false,
  onExitMission,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const routeOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const baseLayerRef = useRef<ImageryLayer | null>(null);
  const imageryLayersRef = useRef<Partial<Record<MarsLayerId, ImageryLayer>>>(
    {}
  );
  const roverEntityRef = useRef<import("cesium").Entity | null>(null);
  const marsEllipsoidRef = useRef<Ellipsoid | null>(null);
  const molaDemRef = useRef<MolaDem | null>(null);
  const jezeroDemRef = useRef<JezeroDem | null>(null);
  const regionalImageryLayerRef = useRef<ImageryLayer | null>(null);
  const externalTerrainActiveRef = useRef(false);
  const missionModeRef = useRef(missionMode);
  missionModeRef.current = missionMode;
  const [layers, setLayers] = useState(MARS_LAYER_DEFAULTS);
  const [baseLayerStatus, setBaseLayerStatus] = useState("NASA Mars Trek");
  const [terrainStatus, setTerrainStatus] = useState(
    "Loading bundled MOLA elevation data"
  );
  const [missionDataNotice, setMissionDataNotice] = useState<string | null>(
    null
  );
  const [missionRoute, setMissionRoute] = useState<MissionRouteState | null>(
    null
  );
  const [missionProgress, setMissionProgress] = useState(0);
  const [roverMoving, setRoverMoving] = useState(false);
  const [followRover, setFollowRover] = useState(true);
  const [cameraAngle, setCameraAngle] = useState(0);
  const [missionComplete, setMissionComplete] = useState(false);
  const [missionPreparing, setMissionPreparing] = useState(missionMode);
  const [missionElevationProfile, setMissionElevationProfile] = useState<
    Array<number | null>
  >([]);
  const [missionElevationSource, setMissionElevationSource] = useState("");
  const missionProgressRef = useRef(0);
  const missionRenderOriginOffsetRef = useRef(0);
  const suspendedGlobalImageryRef = useRef<
    Array<{ layer: ImageryLayer; show: boolean }> | null
  >(null);

  const hideGlobalImageryForRegionalMission = () => {
    if (suspendedGlobalImageryRef.current) return;
    const globalLayers = [
      baseLayerRef.current,
      ...Object.values(imageryLayersRef.current),
    ].filter((layer): layer is ImageryLayer => layer !== null && layer !== undefined);
    suspendedGlobalImageryRef.current = globalLayers.map((layer) => ({
      layer,
      show: layer.show,
    }));
    globalLayers.forEach((layer) => {
      layer.show = false;
    });
  };

  const restoreGlobalImagery = () => {
    const savedLayers = suspendedGlobalImageryRef.current;
    const viewer = viewerRef.current;
    if (!savedLayers) return;
    if (viewer && !viewer.isDestroyed?.()) {
      savedLayers.forEach(({ layer, show }) => {
        layer.show = show;
      });
    }
    suspendedGlobalImageryRef.current = null;
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const marsEllipsoid = new Ellipsoid(3396190.0, 3396190.0, 3376200.0);
    marsEllipsoidRef.current = marsEllipsoid;
    const tilingScheme = new GeographicTilingScheme({
      ellipsoid: marsEllipsoid,
    });
    const backendTilingScheme = new WebMercatorTilingScheme({
      ellipsoid: marsEllipsoid,
    });
    const apiBase = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
    const apiTilesUrl = apiBase ? `${apiBase}/tiles/{z}/{x}/{y}.png` : "";
    const terrainUrl = process.env.REACT_APP_MARS_TERRAIN_URL;
    const geologyWmsUrl = process.env.REACT_APP_USGS_MARS_GEOLOGY_WMS_URL;
    const geologyWmsLayers = process.env.REACT_APP_USGS_MARS_GEOLOGY_WMS_LAYERS;
    let disposed = false;
    let tileProbe: AbortController | null = null;
    let regionalMissionActive = false;
    const baseProvider = new UrlTemplateImageryProvider({
      url: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
      tilingScheme,
      maximumLevel: 7,
      credit: new Credit("NASA Mars Trek - Viking Color Mosaic"),
    });

    const viewer = new Viewer(containerRef.current, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      fullscreenButton: false,
      sceneModePicker: false,
      skyAtmosphere: new SkyAtmosphere(marsEllipsoid),
      ellipsoid: marsEllipsoid,
      globe: new Globe(marsEllipsoid),
      mapProjection: new GeographicProjection(marsEllipsoid),
      shouldAnimate: false,
    });
    viewerRef.current = viewer;
    const bundledDemPromise = loadMolaDem();
    const regionalDemPromise = missionModeRef.current
      ? loadJezeroDem().catch(() => null)
      : Promise.resolve(null);
    let externalTerrainFailed = false;
    let missionStartSequence = 0;
    viewer.scene.globe.baseColor =
      Color.fromCssColorString("#9f5536") ?? Color.WHITE;
    viewer.scene.globe.showGroundAtmosphere = !missionModeRef.current;
    viewer.scene.globe.show = !missionModeRef.current;
    if (missionModeRef.current) {
      viewer.scene.skyBox = undefined;
      viewer.scene.skyAtmosphere = undefined;
      viewer.scene.backgroundColor =
        Color.fromCssColorString("#74513f") ?? Color.WHITE;
    }
    const renderRoute = (route: { path: LonLat[]; color: string } | null) => {
      viewer.entities.removeById("tareeq-route-outline");
      viewer.entities.removeById("tareeq-active-route");
      if (!route || route.path.length < 2) return;

      const coordinates = route.path.flatMap(([longitude, latitude]) => [
        longitude,
        latitude,
      ]);
      const positions = missionModeRef.current
        ? Cartesian3.fromDegreesArrayHeights(
            route.path.flatMap(([longitude, latitude]) => [
              longitude,
              latitude,
              missionSurfaceHeightAt(
                viewer,
                longitude,
                latitude,
                jezeroDemRef.current,
                molaDemRef.current,
                externalTerrainActiveRef.current,
                missionRenderOriginOffsetRef.current
              ) + MISSION_ROUTE_DISPLAY_CLEARANCE_M,
            ]),
            marsEllipsoid
          )
        : Cartesian3.fromDegreesArray(coordinates, marsEllipsoid);
      viewer.entities.add({
        id: "tareeq-route-outline",
        polyline: {
          positions,
          width: missionModeRef.current ? 16 : 8,
          clampToGround: !missionModeRef.current,
          material: Color.fromCssColorString("#171717") ?? Color.YELLOW,
        },
      });
      viewer.entities.add({
        id: "tareeq-active-route",
        polyline: {
          positions,
          width: missionModeRef.current ? 9 : 5,
          clampToGround: !missionModeRef.current,
          material:
            Color.fromCssColorString(
              missionModeRef.current ? "#ffbf00" : route.color
            ) ?? Color.YELLOW,
        },
      });
    };
    const unsubscribeFromRoute = subscribeToActiveRoute(renderRoute);
    const unsubscribeFromMission = subscribeToMissionRouteState((route) => {
      const sequence = ++missionStartSequence;
      setMissionRoute(route);
      renderRoute(route);
      viewer.entities.removeById("tareeq-mission-start");
      viewer.entities.removeById("tareeq-mission-destination");
      viewer.entities.removeById("tareeq-rover");
      viewer.entities.removeById("tareeq-rover-travelled");
      if (!missionModeRef.current || !route || route.path.length < 2) {
        restoreGlobalImagery();
        setMissionElevationProfile([]);
        setMissionElevationSource("");
        setRoverMoving(false);
        setMissionPreparing(false);
        return;
      }

      setMissionProgress(0);
      missionProgressRef.current = 0;
      setMissionComplete(false);
      setRoverMoving(false);
      setMissionPreparing(true);
      const beginMission = (
        dem: MolaDem | null,
        regionalDem: JezeroDem | null
      ) => {
        if (
          disposed ||
          sequence !== missionStartSequence ||
          !missionModeRef.current
        )
          return;
        if (dem) molaDemRef.current = dem;
      const useRegionalDem = Boolean(
          regionalDem && regionalDem.coversPath(route.path)
        );
        regionalMissionActive = useRegionalDem;
        const profileDataset = useRegionalDem ? regionalDem : dem;
        setMissionElevationProfile(
          profileDataset
            ? route.path.map(([longitude, latitude]) =>
                profileDataset.sampleElevation(longitude, latitude)
              )
            : []
        );
        setMissionElevationSource(
          useRegionalDem ? "CTX DTM · areoid" : dem ? "MOLA · areoid" : ""
        );
        const renderOriginOffsetMeters =
          externalTerrainActiveRef.current && !useRegionalDem
            ? 0
            : missionRenderOriginOffset(
                route.path,
                useRegionalDem ? regionalDem : null,
                dem
              );
        missionRenderOriginOffsetRef.current = renderOriginOffsetMeters;
        const datumStatus = dem?.ellipsoidHeightFromAreoidElevation
          ? `${MOLA_AREOID_LABEL} → Mars ellipsoid`
          : "MOLA areoid grid unavailable; vertical conversion not applied";
        const originStatus = renderOriginOffsetMeters
          ? `local scene origin ${renderOriginOffsetMeters > 0 ? "+" : ""}${Math.round(
              renderOriginOffsetMeters
            ).toLocaleString()} m (display only)`
          : "no local scene-origin translation";
        if (useRegionalDem && regionalDem) {
          jezeroDemRef.current = regionalDem;
          externalTerrainActiveRef.current = false;
          viewer.terrainProvider = createJezeroTerrainProvider(
            regionalDem,
            marsEllipsoid,
            dem,
            renderOriginOffsetMeters
          );
          if (regionalImageryLayerRef.current) {
            viewer.imageryLayers.remove(regionalImageryLayerRef.current, true);
          }
          regionalImageryLayerRef.current =
            viewer.imageryLayers.addImageryProvider(
              createJezeroOrthophotoProvider(regionalDem, marsEllipsoid)
            );
          viewer.imageryLayers.raiseToTop?.(regionalImageryLayerRef.current);
          hideGlobalImageryForRegionalMission();
          setTerrainStatus(
            `${JEZERO_DEM_LABEL} + ${JEZERO_ORTHO_LABEL} · ${datumStatus} · ${originStatus} · route line +${MISSION_ROUTE_DISPLAY_CLEARANCE_M} m display lift · source data/costs unchanged`
          );
          setMissionDataNotice(
            dem?.ellipsoidHeightFromAreoidElevation
              ? null
              : "MOLA areoid reference data is unavailable. The CTX raster values and route costs remain unchanged, but their displayed vertical placement is approximate."
          );
        } else {
          restoreGlobalImagery();
          jezeroDemRef.current = null;
          if (regionalImageryLayerRef.current) {
            viewer.imageryLayers.remove(regionalImageryLayerRef.current, true);
            regionalImageryLayerRef.current = null;
          }
          if (dem && !externalTerrainActiveRef.current) {
            viewer.terrainProvider = createMolaTerrainProvider(
              dem,
              marsEllipsoid,
              renderOriginOffsetMeters
            );
            setTerrainStatus(
              `${MOLA_DEM_LABEL} · ${datumStatus} · ${originStatus} · route line +${MISSION_ROUTE_DISPLAY_CLEARANCE_M} m display lift · ${
                regionalDem
                  ? "outside Jezero coverage"
                  : "Jezero data unavailable"
              }`
            );
          }
          const coverageNotice =
            regionalDem
              ? "This route is outside the verified Jezero CTX footprint. The rover is using global MOLA 4 ppd terrain (~14.8 km cells), not rover-scale detail. Add a co-registered local CTX/HiRISE DTM and orthophoto for this site, or use the USGS HRSC–MOLA 200 m global DEM."
              : "The Jezero CTX regional files could not be loaded. This mission is using global MOLA 4 ppd terrain (~14.8 km cells), not rover-scale detail. Check the bundled data files, or add a co-registered CTX/HiRISE DTM and orthophoto for this site.";
          setMissionDataNotice(
            dem?.ellipsoidHeightFromAreoidElevation
              ? coverageNotice
              : `${coverageNotice} MOLA areoid reference data is unavailable, so displayed vertical placement is approximate.`
          );
        }
        viewer.scene.globe.show = true;
        const [startLon, startLat] = route.path[0];
        const [endLon, endLat] = route.path[route.path.length - 1];
        const startSurfaceHeight = missionSurfaceHeightAt(
          viewer,
          startLon,
          startLat,
          jezeroDemRef.current,
          dem,
          externalTerrainActiveRef.current,
          renderOriginOffsetMeters
        );
        const endSurfaceHeight = missionSurfaceHeightAt(
          viewer,
          endLon,
          endLat,
          jezeroDemRef.current,
          dem,
          externalTerrainActiveRef.current,
          renderOriginOffsetMeters
        );
        const startRoverHeight = startSurfaceHeight + ROVER_SURFACE_CLEARANCE_M;
        const startMarkerHeight = startSurfaceHeight + WAYPOINT_MARKER_CLEARANCE_M;
        const endMarkerHeight = endSurfaceHeight + WAYPOINT_MARKER_CLEARANCE_M;
        viewer.entities.add({
          id: "tareeq-mission-start",
          position: Cartesian3.fromDegrees(
            startLon,
            startLat,
            startMarkerHeight,
            marsEllipsoid
          ),
          point: {
            pixelSize: 12,
            color: Color.fromCssColorString("#f5f5f5"),
            outlineColor: Color.BLACK,
            outlineWidth: 2,
          },
          label: {
            text: "START",
            font: "12px sans-serif",
            fillColor: Color.WHITE,
            pixelOffset: new Cartesian2(0, -18),
          },
        });
        viewer.entities.add({
          id: "tareeq-mission-destination",
          position: Cartesian3.fromDegrees(
            endLon,
            endLat,
            endMarkerHeight,
            marsEllipsoid
          ),
          point: {
            pixelSize: 14,
            color: Color.fromCssColorString("#e87524"),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
          },
          label: {
            text: "DESTINATION",
            font: "12px sans-serif",
            fillColor: Color.WHITE,
            pixelOffset: new Cartesian2(0, -20),
          },
        });
        const publicRoot = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
        const roverModelUrl =
          process.env.REACT_APP_MARS_ROVER_MODEL_URL ||
          `${publicRoot}/models/curiosity.glb`;
        const roverEntity = viewer.entities.add({
          id: "tareeq-rover",
          position: Cartesian3.fromDegrees(
            startLon,
            startLat,
            startRoverHeight,
            marsEllipsoid
          ),
          model: {
            uri: roverModelUrl,
            scale: 1,
            minimumPixelSize: 96,
          },
        });
        roverEntityRef.current = roverEntity;
        renderRoute(route);
        const heading = routeHeading(route.path[0], route.path[1]);
        placeMissionCamera(
          viewer,
          route.path[0],
          heading,
          jezeroDemRef.current,
          dem,
          externalTerrainActiveRef.current,
          marsEllipsoid,
          0,
          renderOriginOffsetMeters
        );
        setMissionPreparing(false);
        setRoverMoving(true);
      };
      void Promise.all([
        regionalDemPromise,
        bundledDemPromise.catch(() => null),
      ]).then(([regionalDem, dem]) => beginMission(dem, regionalDem));
    });

    const cameraController = viewer.scene.screenSpaceCameraController;
    cameraController.enableInputs = true;
    cameraController.enableZoom = true;
    cameraController.inertiaZoom = 0.8;
    viewer.canvas.style.touchAction = "none";

    baseLayerRef.current = viewer.imageryLayers.addImageryProvider(
      baseProvider,
      0
    );

    const marsImagery = [
      {
        id: "mola" as const,
        url: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
        maximumLevel: 7,
        credit: "NASA MGS MOLA Colorized Hillshade",
      },
      {
        id: "themisDay" as const,
        url: "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{z}/{y}/{x}.png",
        maximumLevel: 9,
        credit: "NASA Mars Odyssey THEMIS Day IR",
      },
    ];

    marsImagery.forEach(({ id, url, credit }) => {
      imageryLayersRef.current[id] = viewer.imageryLayers.addImageryProvider(
        new UrlTemplateImageryProvider({
          url,
          tilingScheme,
          maximumLevel: id === "themisDay" ? 9 : 7,
          credit: new Credit(credit),
        })
      );
    });

    if (geologyWmsUrl && geologyWmsLayers) {
      imageryLayersRef.current.geology =
        viewer.imageryLayers.addImageryProvider(
          new WebMapServiceImageryProvider({
            url: geologyWmsUrl,
            layers: geologyWmsLayers,
            parameters: { format: "image/png", transparent: true },
            tilingScheme,
            credit: new Credit("USGS-NASA Planetary Geologic Mapping Program"),
          })
        );
    }

    void bundledDemPromise
      .then((dem) => {
        if (disposed) return;
        molaDemRef.current = dem;
        if (regionalMissionActive) return;
        if (!terrainUrl || externalTerrainFailed) {
          const molaTerrain = createMolaTerrainProvider(dem, marsEllipsoid);
          viewer.terrainProvider = molaTerrain;
          externalTerrainActiveRef.current = false;
          setTerrainStatus(
            externalTerrainFailed
              ? `${MOLA_DEM_LABEL} (fallback)`
              : MOLA_DEM_LABEL
          );
        }
      })
      .catch((error: unknown) => {
        if (!disposed && !terrainUrl) {
          setTerrainStatus(
            "Bundled MOLA DEM unavailable; using a flat Mars ellipsoid"
          );
          if (process.env.NODE_ENV !== "test") {
            // eslint-disable-next-line no-console
            console.error("Unable to load bundled Mars MOLA DEM.", error);
          }
        }
      });

    if (terrainUrl) {
      void CesiumTerrainProvider.fromUrl(terrainUrl, {
        ellipsoid: marsEllipsoid,
        requestVertexNormals: true,
      })
        .then((terrainProvider) => {
          if (disposed || viewer.isDestroyed()) return;
          if (regionalMissionActive) return;
          viewer.terrainProvider = terrainProvider;
          externalTerrainActiveRef.current = true;
          setTerrainStatus("Configured Mars DEM active");
        })
        .catch((error: unknown) => {
          if (!disposed) {
            if (regionalMissionActive) return;
            externalTerrainFailed = true;
            externalTerrainActiveRef.current = false;
            setTerrainStatus(
              "Configured DEM unavailable; switching to bundled MOLA data"
            );
            void bundledDemPromise
              .then((dem) => {
                if (disposed) return;
                molaDemRef.current = dem;
                const molaTerrain = createMolaTerrainProvider(
                  dem,
                  marsEllipsoid
                );
                viewer.terrainProvider = molaTerrain;
                setTerrainStatus(`${MOLA_DEM_LABEL} (fallback)`);
              })
              .catch(() =>
                setTerrainStatus(
                  "Configured and bundled Mars DEMs unavailable; using a flat ellipsoid"
                )
              );
            if (process.env.NODE_ENV !== "test") {
              // eslint-disable-next-line no-console
              console.warn("Configured Mars DEM is unavailable.", error);
            }
          }
        });
    }

    if (!missionModeRef.current) {
      const destination = Cartesian3.fromDegrees(
        0,
        0,
        5_000_000,
        marsEllipsoid
      );
      viewer.camera.setView({
        destination,
        orientation: {
          direction: new Cartesian3(-1, 0, 0),
          up: new Cartesian3(0, 0, 1),
        },
      });
    }

    if (apiTilesUrl) {
      const controller = new AbortController();
      tileProbe = controller;
      const timeout = window.setTimeout(() => controller.abort(), 2500);
      const testUrl = apiTilesUrl
        .replace("{z}", "0")
        .replace("{x}", "0")
        .replace("{y}", "0");

      void fetch(testUrl, { method: "HEAD", signal: controller.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              `Backend imagery probe failed with status ${response.status}`
            );
          }

          const currentViewer = viewerRef.current;
          const currentBaseLayer = baseLayerRef.current;
          if (!currentViewer || !currentBaseLayer) return;

          const backendLayer = currentViewer.imageryLayers.addImageryProvider(
            new UrlTemplateImageryProvider({
              url: apiTilesUrl,
              tilingScheme: backendTilingScheme,
              credit: new Credit("MOLA/OPM backend imagery"),
            }),
            0
          );
          currentViewer.imageryLayers.remove(currentBaseLayer, true);
          baseLayerRef.current = backendLayer;
        })
        .catch((error: unknown) => {
          if (
            !disposed &&
            error instanceof Error &&
            error.name !== "AbortError"
          ) {
            setBaseLayerStatus(`NASA fallback (${error.message})`);
          }
        })
        .finally(() => {
          window.clearTimeout(timeout);
        });
    }

    return () => {
      disposed = true;
      unsubscribeFromRoute();
      unsubscribeFromMission();
      restoreGlobalImagery();
      tileProbe?.abort();
      viewer.destroy();
      viewerRef.current = null;
      roverEntityRef.current = null;
      marsEllipsoidRef.current = null;
      molaDemRef.current = null;
      jezeroDemRef.current = null;
      regionalImageryLayerRef.current = null;
      externalTerrainActiveRef.current = false;
      baseLayerRef.current = null;
      imageryLayersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!missionMode || !roverMoving || !missionRoute || missionComplete)
      return;
    const timer = window.setInterval(() => {
      setMissionProgress((current) => {
        const next = Math.min(1, current + 0.002);
        missionProgressRef.current = next;
        if (next >= 1) {
          setRoverMoving(false);
          setMissionComplete(true);
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [missionMode, roverMoving, missionRoute, missionComplete]);

  useEffect(() => {
    if (
      !missionMode ||
      !missionRoute ||
      !viewerRef.current ||
      !roverEntityRef.current
    )
      return;
    const viewer = viewerRef.current;
    const point = pointAlongRoute(missionRoute.path, missionProgress);
    const nextPoint = pointAlongRoute(
      missionRoute.path,
      Math.min(1, missionProgress + 0.002)
    );
    const ellipsoid = marsEllipsoidRef.current;
    const height =
      missionSurfaceHeightAt(
        viewer,
        point[0],
        point[1],
        jezeroDemRef.current,
        molaDemRef.current,
        externalTerrainActiveRef.current,
        missionRenderOriginOffsetRef.current
      ) + ROVER_SURFACE_CLEARANCE_M;
    const markerLocations: Array<[string, LonLat]> = [
      ["tareeq-mission-start", missionRoute.path[0]],
      [
        "tareeq-mission-destination",
        missionRoute.path[missionRoute.path.length - 1],
      ],
    ];
    markerLocations.forEach(([id, markerPoint]) => {
      const marker = viewer.entities.getById?.(id);
      if (!marker || !markerPoint) return;
      marker.position = new ConstantPositionProperty(
        Cartesian3.fromDegrees(
          markerPoint[0],
          markerPoint[1],
          missionSurfaceHeightAt(
            viewer,
            markerPoint[0],
            markerPoint[1],
            jezeroDemRef.current,
            molaDemRef.current,
            externalTerrainActiveRef.current,
            missionRenderOriginOffsetRef.current
          ) + WAYPOINT_MARKER_CLEARANCE_M,
          ellipsoid ?? undefined
        )
      );
    });
    roverEntityRef.current.position = new ConstantPositionProperty(
      Cartesian3.fromDegrees(point[0], point[1], height, ellipsoid ?? undefined)
    );
    const heading = routeHeading(point, nextPoint);
    if (roverEntityRef.current.billboard) {
      roverEntityRef.current.billboard.rotation = new ConstantProperty(
        -heading
      );
    }
    if (roverEntityRef.current.model) {
      roverEntityRef.current.orientation = new ConstantProperty(
        Transforms.headingPitchRollQuaternion(
          Cartesian3.fromDegrees(
            point[0],
            point[1],
            height,
            ellipsoid ?? undefined
          ),
          new HeadingPitchRoll(heading, 0, 0),
          ellipsoid ?? undefined
        )
      );
    }

    viewer.entities.removeById("tareeq-rover-travelled");
    const pathIndex = Math.floor(
      missionProgress * (missionRoute.path.length - 1)
    );
    const travelledPath = [...missionRoute.path.slice(0, pathIndex + 1), point];
    if (travelledPath.length > 1) {
      const coordinates = travelledPath.flatMap(([longitude, latitude]) => [
        longitude,
        latitude,
        missionSurfaceHeightAt(
          viewer,
          longitude,
          latitude,
          jezeroDemRef.current,
          molaDemRef.current,
          externalTerrainActiveRef.current,
          missionRenderOriginOffsetRef.current
        ) + MISSION_ROUTE_DISPLAY_CLEARANCE_M,
      ]);
      viewer.entities.add({
        id: "tareeq-rover-travelled",
        polyline: {
          positions: Cartesian3.fromDegreesArrayHeights(
            coordinates,
            ellipsoid ?? undefined
          ),
          width: 9,
          clampToGround: false,
          material: Color.fromCssColorString("#ffbf00"),
        },
      });
    }

    if (followRover) {
      if (ellipsoid) {
        placeMissionCamera(
          viewer,
          point,
          heading,
          jezeroDemRef.current,
          molaDemRef.current,
          externalTerrainActiveRef.current,
          ellipsoid,
          cameraAngle,
          missionRenderOriginOffsetRef.current
        );
      }
    }
  }, [missionMode, missionRoute, missionProgress, followRover, cameraAngle]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const overlay = routeOverlayRef.current;
    if (
      process.env.NODE_ENV === "test" ||
      !missionMode ||
      !missionRoute ||
      !viewer ||
      !overlay
    ) {
      return;
    }

    const context = overlay.getContext("2d");
    if (!context) return;

    const drawRouteOverlay = () => {
      if (viewer.isDestroyed()) return;
      const rect = viewer.canvas.getBoundingClientRect();
      const parentRect = overlay.parentElement?.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.round(rect.width * pixelRatio);
      const height = Math.round(rect.height * pixelRatio);
      if (overlay.width !== width || overlay.height !== height) {
        overlay.width = width;
        overlay.height = height;
      }
      overlay.style.left = `${
        parentRect ? rect.left - parentRect.left : 0
      }px`;
      overlay.style.top = `${parentRect ? rect.top - parentRect.top : 0}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      const routeEntity = viewer.entities.getById("tareeq-active-route");
      const positions = routeEntity?.polyline?.positions?.getValue(
        viewer.clock.currentTime
      );
      if (!positions || positions.length < 2) return;

      const projected = positions.map((position: Cartesian3) =>
        viewer.scene.cartesianToCanvasCoordinates(position)
      );
      const strokeRoute = (color: string, lineWidth: number) => {
        context.beginPath();
        let connected = false;
        projected.forEach((point: Cartesian2 | undefined) => {
          if (
            !point ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y)
          ) {
            connected = false;
            return;
          }
          if (connected) context.lineTo(point.x, point.y);
          else context.moveTo(point.x, point.y);
          connected = true;
        });
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke();
      };

      context.save();
      context.shadowColor = "rgba(0, 0, 0, 0.75)";
      context.shadowBlur = 7;
      strokeRoute("rgba(10, 10, 10, 0.96)", 13);
      context.shadowBlur = 0;
      strokeRoute("#ffbf00", 6);
      context.restore();

      const roverPosition = viewer.entities
        .getById("tareeq-rover")
        ?.position?.getValue(viewer.clock.currentTime);
      const roverScreen = roverPosition
        ? viewer.scene.cartesianToCanvasCoordinates(roverPosition)
        : undefined;
      if (
        roverScreen &&
        Number.isFinite(roverScreen.x) &&
        Number.isFinite(roverScreen.y)
      ) {
        context.save();
        context.globalCompositeOperation = "destination-out";
        context.beginPath();
        context.arc(roverScreen.x, roverScreen.y, 24, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };

    const removePostRenderListener = viewer.scene.postRender.addEventListener(
      drawRouteOverlay
    );
    drawRouteOverlay();
    return () => {
      removePostRenderListener();
      context.clearRect(0, 0, overlay.width, overlay.height);
    };
  }, [missionMode, missionRoute]);

  useEffect(() => {
    (Object.keys(layers) as MarsLayerId[]).forEach((id) => {
      const imageryLayer = imageryLayersRef.current[id];
      if (imageryLayer) {
        const suspended = suspendedGlobalImageryRef.current?.some(
          (entry) => entry.layer === imageryLayer
        );
        imageryLayer.show = suspended ? false : layers[id].visible;
        imageryLayer.alpha = layers[id].opacity;
      }
    });
  }, [layers]);

  const updateLayer = (id: MarsLayerId, updates: Partial<MarsLayerState>) => {
    setLayers((current) => ({
      ...current,
      [id]: { ...current[id], ...updates },
    }));
  };

  const zoomCamera = (zoomIn: boolean) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const distance = Math.max(
      1,
      Math.min(1_000_000, viewer.camera.positionCartographic.height * 0.2)
    );
    if (zoomIn) viewer.camera.zoomIn(distance);
    else viewer.camera.zoomOut(distance);
  };

  const moveRover = useCallback(
    (amount: number) => {
      if (!missionRoute || missionComplete) return;
      setMissionProgress((current) => {
        const next = Math.max(0, Math.min(1, current + amount));
        missionProgressRef.current = next;
        if (next >= 1) {
          setRoverMoving(false);
          setMissionComplete(true);
        }
        return next;
      });
    },
    [missionRoute, missionComplete]
  );

  const rotateCamera = useCallback((direction: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setFollowRover(false);
    setCameraAngle((angle) => angle + direction * (Math.PI / 8));
    if (direction < 0) viewer.camera.rotateLeft(Math.PI / 8);
    else viewer.camera.rotateRight(Math.PI / 8);
  }, []);

  useEffect(() => {
    if (!missionMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const key = event.key.toLowerCase();
      if (key === "w" || event.key === "ArrowUp") {
        event.preventDefault();
        moveRover(0.012);
      } else if (key === "s" || event.key === "ArrowDown") {
        event.preventDefault();
        moveRover(-0.012);
      } else if (key === "a" || event.key === "ArrowLeft") {
        event.preventDefault();
        moveRover(-1 / Math.max(1, (missionRoute?.path.length ?? 2) - 1));
      } else if (key === "d" || event.key === "ArrowRight") {
        event.preventDefault();
        moveRover(1 / Math.max(1, (missionRoute?.path.length ?? 2) - 1));
      } else if (key === " ") {
        event.preventDefault();
        setRoverMoving((moving) => !moving);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [missionMode, missionRoute, moveRover]);

  const missionDistance = missionRoute
    ? missionRoute.distanceKm ?? routeDistanceKm(missionRoute.path)
    : 0;
  const distanceTravelled = missionDistance * missionProgress;
  const distanceRemaining = Math.max(0, missionDistance - distanceTravelled);
  const currentPosition = missionRoute
    ? pointAlongRoute(missionRoute.path, missionProgress)
    : null;
  const waypointCount = missionRoute?.path.length ?? 0;
  const currentWaypoint =
    waypointCount > 0
      ? Math.min(
          waypointCount,
          Math.floor(missionProgress * (waypointCount - 1)) + 1
        )
      : 0;

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {missionMode ? (
        <canvas
          ref={routeOverlayRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[5]"
        />
      ) : null}
      {missionMode ? (
        <>
          <div className="pointer-events-none absolute left-5 top-5 z-10 flex items-center gap-3 rounded-full border border-white/10 bg-[#08090b]/75 px-4 py-2.5 text-white shadow-lg backdrop-blur-md">
            <span
              className={`h-2 w-2 rounded-full ${
                missionComplete
                  ? "bg-emerald-400"
                  : roverMoving
                  ? "animate-pulse bg-orange-400"
                  : "bg-white/50"
              }`}
            />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">
              {missionComplete
                ? "Mission complete"
                : roverMoving
                ? "Rover moving"
                : "Rover stopped"}
            </span>
            {currentPosition && (
              <span className="border-l border-white/15 pl-3 text-[10px] text-white/55">
                Current {coordinateLabel(currentPosition)} · WP{" "}
                {currentWaypoint}/{waypointCount}
              </span>
            )}
          </div>

          {missionRoute && currentPosition && (
            <MissionRouteMiniMap
              path={missionRoute.path}
              current={currentPosition}
              progress={missionProgress}
              elevationProfile={missionElevationProfile}
              elevationSource={missionElevationSource}
            />
          )}

          {missionPreparing && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#4a3023]/90 p-6 text-center backdrop-blur-sm">
              <div className="max-w-sm rounded-2xl border border-white/15 bg-[#111317]/90 px-8 py-7 text-white shadow-2xl">
                <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-orange-400" />
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-200">
                  Regional mission view
                </p>
                <p className="mt-2 text-sm text-white/70">
                  Loading local terrain and placing the Curiosity rover…
                </p>
              </div>
            </div>
          )}

          {missionDataNotice && !missionPreparing && (
            <aside
              role="status"
              className="absolute right-4 top-1/2 z-20 w-[min(340px,calc(100%-2rem))] -translate-y-1/2 rounded-2xl border border-amber-200/20 bg-[#111317]/90 p-4 text-white shadow-2xl backdrop-blur-md"
            >
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
                High-resolution coverage unavailable
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-white/75">
                {missionDataNotice}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-sky-200 underline decoration-sky-200/40 underline-offset-2">
                <a
                  href="https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m"
                  target="_blank"
                  rel="noreferrer"
                >
                  USGS HRSC–MOLA global DEM
                </a>
                <a
                  href="https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=MRO-M-HIRISE-5-DTM-V1.0"
                  target="_blank"
                  rel="noreferrer"
                >
                  NASA HiRISE local DTMs
                </a>
              </div>
            </aside>
          )}

          <div className="absolute bottom-5 left-1/2 z-20 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#08090b]/85 p-3 text-white shadow-xl backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-3 px-1 text-[11px] text-white/75">
              <span>
                Start{" "}
                {missionRoute ? coordinateLabel(missionRoute.path[0]) : "—"}
              </span>
              <span>{distanceTravelled.toFixed(1)} km traveled</span>
              <span>{Math.round(missionProgress * 100)}%</span>
              <span>{distanceRemaining.toFixed(1)} km remaining</span>
              <span>
                End{" "}
                {missionRoute
                  ? coordinateLabel(
                      missionRoute.path[missionRoute.path.length - 1]
                    )
                  : "—"}
              </span>
            </div>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#e87524] transition-[width]"
                style={{ width: `${missionProgress * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Drive left to previous waypoint"
                  title="Previous waypoint (A)"
                  onClick={() =>
                    moveRover(
                      -1 / Math.max(1, (missionRoute?.path.length ?? 2) - 1)
                    )
                  }
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Drive right to next waypoint"
                  title="Next waypoint (D)"
                  onClick={() =>
                    moveRover(
                      1 / Math.max(1, (missionRoute?.path.length ?? 2) - 1)
                    )
                  }
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  title="Zoom in"
                  onClick={() => zoomCamera(true)}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Zoom out"
                  title="Zoom out"
                  onClick={() => zoomCamera(false)}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Drive backward"
                  title="Backward (S)"
                  onClick={() => moveRover(-0.012)}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Drive forward"
                  title="Forward (W)"
                  onClick={() => moveRover(0.012)}
                  className="rounded-full bg-[#cc5500] p-2.5 text-white hover:bg-[#e87524]"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={roverMoving ? "Pause rover" : "Resume rover"}
                  title={roverMoving ? "Pause rover" : "Resume rover"}
                  onClick={() => setRoverMoving((moving) => !moving)}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                >
                  {roverMoving ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Stop rover"
                  title="Stop rover"
                  onClick={() => setRoverMoving(false)}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                >
                  <Square className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Change camera angle"
                  title="Rotate camera"
                  onClick={() => rotateCamera(1)}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                >
                  <Camera className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={
                    followRover ? "Disable rover follow" : "Follow rover"
                  }
                  title={followRover ? "Camera follows rover" : "Follow rover"}
                  onClick={() => setFollowRover((following) => !following)}
                  className={`rounded-full p-2 ${
                    followRover ? "text-orange-300" : "text-white/60"
                  } hover:bg-white/10`}
                >
                  <span className="text-[10px] font-semibold">F</span>
                </button>
              </div>
            </div>
            <div className="mt-2 text-center text-[10px] text-white/45">
              W / ↑ drive · S / ↓ reverse · A / ← previous point · D / → next
              point · Space pause
            </div>
          </div>

          {!missionRoute && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 text-center">
              <div>
                <p className="text-lg font-medium">No calculated route</p>
                <button
                  type="button"
                  onClick={onExitMission}
                  className="mt-4 rounded-full bg-[#cc5500] px-5 py-2 text-sm font-semibold"
                >
                  Plan a route
                </button>
              </div>
            </div>
          )}

          {missionComplete && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-sm">
              <div className="rounded-2xl border border-white/10 bg-[#111317]/95 px-8 py-7 text-center shadow-2xl">
                <p className="text-xs uppercase tracking-[0.25em] text-orange-300">
                  Mission complete
                </p>
                <h2 className="mt-2 text-3xl font-semibold">
                  Destination reached
                </h2>
                <p className="mt-2 text-sm text-white/65">
                  {missionDistance.toFixed(1)} km traveled
                </p>
                <button
                  type="button"
                  onClick={onExitMission}
                  className="mt-5 rounded-full bg-[#cc5500] px-5 py-2.5 text-sm font-semibold hover:bg-[#e87524]"
                >
                  Plan another mission
                </button>
              </div>
            </div>
          )}

          <div className="absolute bottom-2 right-3 z-10 max-w-[55vw] text-right text-[9px] text-white/50">
            {terrainStatus.includes("DEM not configured")
              ? "Mars ellipsoid · no DEM configured"
              : terrainStatus}
            {" · Curiosity 3D model: NASA/JPL-Caltech"}
          </div>
        </>
      ) : (
        <div className="absolute top-4 right-4 z-10 w-72 rounded-lg border border-gray-700 bg-gray-900/95 p-3 text-white shadow-lg">
          <div className="mb-2 text-sm font-semibold">
            NASA Mars Data Layers
          </div>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              className="rounded bg-gray-700 p-2 hover:bg-gray-600"
              onClick={() => zoomCamera(true)}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              className="rounded bg-gray-700 p-2 hover:bg-gray-600"
              onClick={() => zoomCamera(false)}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
          </div>
          <label className="mb-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={layers.mola.visible}
              onChange={(event) =>
                updateLayer("mola", { visible: event.target.checked })
              }
            />
            <span>MOLA colorized hillshade</span>
          </label>
          {layers.mola.visible && (
            <input
              aria-label="MOLA hillshade opacity"
              className="mb-3 w-full"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={layers.mola.opacity}
              onChange={(event) =>
                updateLayer("mola", { opacity: Number(event.target.value) })
              }
            />
          )}
          <label className="mb-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={layers.themisDay.visible}
              onChange={(event) =>
                updateLayer("themisDay", { visible: event.target.checked })
              }
            />
            <span>THEMIS daytime infrared</span>
          </label>
          {layers.themisDay.visible && (
            <input
              aria-label="THEMIS infrared opacity"
              className="w-full"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={layers.themisDay.opacity}
              onChange={(event) =>
                updateLayer("themisDay", {
                  opacity: Number(event.target.value),
                })
              }
            />
          )}
          <label className="mb-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={layers.geology.visible}
              disabled={!imageryLayersRef.current.geology}
              onChange={(event) =>
                updateLayer("geology", { visible: event.target.checked })
              }
            />
            <span>USGS-NASA geology WMS</span>
          </label>
          {!imageryLayersRef.current.geology && (
            <p className="mb-2 text-[10px] text-gray-400">
              Set the USGS WMS URL and layer names to enable this overlay.
            </p>
          )}
          {layers.geology.visible && imageryLayersRef.current.geology && (
            <input
              aria-label="Geology opacity"
              className="mb-2 w-full"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={layers.geology.opacity}
              onChange={(event) =>
                updateLayer("geology", { opacity: Number(event.target.value) })
              }
            />
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            Basemap: {baseLayerStatus}
          </p>
          <p className="mt-1 text-[10px] text-gray-400">
            Terrain: {terrainStatus}
          </p>
          <p className="mt-2 text-[10px] text-gray-400">
            Scroll or pinch to zoom. The hillshade is imagery; bundled MOLA
            MEGDR supplies numeric elevation.
          </p>
        </div>
      )}
    </div>
  );
};

export default Mars3DViewer;
