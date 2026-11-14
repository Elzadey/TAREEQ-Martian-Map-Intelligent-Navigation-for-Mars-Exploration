# TAREEQ demo release status

- [x] Keep 3D overview and 2D route planning/measurement workflow.
- [x] Show A*, Uniform-Cost Search, and Greedy alternatives; UCS uses terrain-weighted cumulative cost independently of A*.
- [x] On mission start, show the selected regional route, animate the NASA Curiosity model along it, follow it with the camera, and show a route minimap and source-elevation profile.
- [x] Use the verified, matching USGS/NASA Jezero CTX DTM (20 m) and orthophoto (6 m) only when the full route is inside their common footprint. Preserve source coordinates, raw elevations, and route costs; convert areoid-referenced heights for Cesium and keep the computed local scene origin, rover clearance, and 20 m route-line lift display-only.
- [x] Outside Jezero coverage, use bundled global MOLA only with an explicit low-resolution warning; do not present remote-only HiRISE products as integrated data.
- [x] Re-run lint, TypeScript, tests, production build, and a visual Chromium smoke test that confirms the 3D route line, rover, camera-follow, and CTX source-elevation profile appear together. Tests: 24/24 passed; lint and production build completed with existing warnings in unrelated files.
- [ ] A visually rich, game-quality 3D surface like the NASA reference still needs a fully co-registered high-resolution terrain/image pipeline and additional visual iteration. The current mission scene is functional but is not claimed to match that reference.
