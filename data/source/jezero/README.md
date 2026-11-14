# Jezero CTX regional data

This directory contains the original public USGS Astrogeology / NASA Mars 2020 CTX products used by the regional mission scene. The DTM is `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif` (20 m, float32 elevations in metres) and its matching orthophoto is `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif` (6 m, 8-bit grayscale image). Both use `ESRI:103885`, a Mars spherical equirectangular projection with radius 3,396,190 m, central meridian 0°, and positive-east longitude. Their bounds overlap across 100% of the DTM footprint.

In the app, projected metres are converted directly to planetocentric longitude/latitude using the same Mars radius. The original pixel values are retained in the generated DEM and orthophoto derivatives; no AI-generated or synthetic terrain is used. Rebuild the browser assets from the original TIFFs with `python tools/prepare_regional_mars_data.py` after installing `rasterio`, `numpy`, and `Pillow`.

The Cesium mission view translates terrain, rover, and camera heights by a constant +4,000 m for display so a close camera can render this negative-elevation region above the Mars ellipsoid. This is a view-origin transform only: the original DTM files, decoded/sample values, route costs, and scientific elevation labels are not rewritten. Do not interpret Cesium's shifted mission heights as absolute Mars elevations.

These products cover Jezero only (approximately 77.160465–77.698975°E, 18.211027–18.721194°N). Do not use them to texture or raise terrain elsewhere. The user-provided inventory lists separate HiRISE Jezero products as remote-only: a 1 m DTM plus 25 cm orthomosaics. Those are not bundled or paired here; verify their CRS, exact bounds, and overlap before integrating them.

Sources:

- [CTX DTM product page](https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic)
- [CTX DTM GeoTIFF](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif)
- [Matching 6 m CTX orthophoto GeoTIFF](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif)
- Attribution: JPL-Caltech / NASA / USGS Astrogeology Science Center.
