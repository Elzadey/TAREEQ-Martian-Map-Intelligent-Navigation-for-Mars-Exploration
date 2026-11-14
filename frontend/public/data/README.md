# Bundled Mars elevation data

This folder includes the official NASA/PDS4 MGS MOLA MEGDR global topography and areoid rasters. The topography grid supplies coarse global elevation context and route-cost samples; the areoid grid supports conversion to Mars ellipsoid heights for Cesium rendering.

- Product: `megt90n000cb.img` (global Mars topography, 4 samples per degree / 0.25° cells).
- Vertical datum grid: `mega90n000cb.img` (MOLA areoid radius, 4 samples per degree / 0.25° cells).
- Dimensions and encoding: 1440 columns × 720 rows, big-endian signed 16-bit integer, metres above the MOLA areoid; positive-east longitude; planetocentric latitude.
- Approximate cell width: 14.8 km at the equator. The product is suitable for broad regional terrain planning, not for rover-scale obstacle avoidance.
- Official PDS4 topography: https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/megt90n000cb.img
- Official PDS4 areoid grid: https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs-mola_topography_derived/meg004/mega90n000cb.img
- Product metadata/labels: `megt90n000cb.xml` and `mega90n000cb.xml` are included alongside the rasters.
- Mission/data documentation: https://pds-geosciences.wustl.edu/missions/mgs/megdr.html

Keep both raster/label pairs when copying the project. MOLA hillshade/color imagery is a separate visual layer and is not substituted for these numeric elevation values. The route-local Cesium scene origin and small route-line display lift are presentation-only and do not change the source elevation grids.
