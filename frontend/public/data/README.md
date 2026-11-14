# Bundled Mars elevation data

This folder includes the official NASA/PDS4 MGS MOLA MEGDR global topography raster used by TAREEQ for route costs and the 3D surface.

- Product: `megt90n000cb.img` (global Mars topography, 4 samples per degree / 0.25° cells).
- Dimensions and encoding: 1440 columns × 720 rows, big-endian signed 16-bit integer, metres above the MOLA areoid; positive-east longitude; planetocentric latitude.
- Approximate cell width: 14.8 km at the equator. The product is suitable for broad regional terrain planning, not for rover-scale obstacle avoidance.
- Official PDS4 data: https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/megt90n000cb.img
- Product metadata/label: https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/megt90n000cb.xml
- Mission/data documentation: https://pds-geosciences.wustl.edu/missions/mgs/megdr.html

The `.xml` label is included alongside the raw raster. Keep both files when copying the project. MOLA hillshade/color imagery is a separate visual layer and is not substituted for these numeric elevation values.
