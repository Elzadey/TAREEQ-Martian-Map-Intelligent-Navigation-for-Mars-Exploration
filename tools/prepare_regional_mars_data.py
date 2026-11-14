#!/usr/bin/env python3
"""Prepare the verified Jezero CTX DTM/orthophoto pair for the browser mission viewer.

The derived DEM keeps the original float32 elevations in metres and raster row order.
The orthophoto is only transcoded from the source 8-bit grayscale pixels to PNG/RGBA;
no colorization, synthetic terrain, resampling, reprojection, or vertical exaggeration is applied.
Requires rasterio, numpy, and Pillow (PIL).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "data" / "source" / "jezero"
OUTPUT_DIR = ROOT / "frontend" / "public" / "data" / "jezero"
DTM_NAME = "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif"
ORTHO_NAME = "JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif"
MARS_RADIUS_M = 3_396_190.0


def raster_bounds_lonlat(bounds: rasterio.coords.BoundingBox) -> dict[str, float]:
    """Convert spherical Mars equirectangular metres to planetocentric degrees."""
    return {
        "west": math.degrees(bounds.left / MARS_RADIUS_M),
        "south": math.degrees(bounds.bottom / MARS_RADIUS_M),
        "east": math.degrees(bounds.right / MARS_RADIUS_M),
        "north": math.degrees(bounds.top / MARS_RADIUS_M),
    }


def main() -> None:
    dem_path = SOURCE_DIR / DTM_NAME
    ortho_path = SOURCE_DIR / ORTHO_NAME
    if not dem_path.is_file() or not ortho_path.is_file():
        raise SystemExit(
            "Missing source GeoTIFFs. Place the official CTX Jezero DTM and its matching "
            f"orthophoto in {SOURCE_DIR}."
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with rasterio.open(dem_path) as dem, rasterio.open(ortho_path) as ortho:
        if dem.crs != ortho.crs:
            raise SystemExit(f"CRS mismatch: DTM={dem.crs}; orthophoto={ortho.crs}")
        if dem.count != 1 or ortho.count != 1:
            raise SystemExit("Expected single-band CTX DTM and grayscale orthophoto.")
        if dem.dtypes[0] != "float32" or ortho.dtypes[0] != "uint8":
            raise SystemExit("Unexpected source pixel type; refusing a lossy conversion.")
        projection = dem.crs.to_proj4()
        if "+proj=eqc" not in projection or "+R=3396190" not in projection:
            raise SystemExit(f"Unexpected Mars CRS; refusing to assume coordinates: {projection}")

        db, ob = dem.bounds, ortho.bounds
        left, bottom = max(db.left, ob.left), max(db.bottom, ob.bottom)
        right, top = min(db.right, ob.right), min(db.top, ob.top)
        if right <= left or top <= bottom:
            raise SystemExit("The DTM and orthophoto do not overlap.")
        overlap_pct = 100.0 * (right - left) * (top - bottom) / (
            (db.right - db.left) * (db.top - db.bottom)
        )
        if overlap_pct < 99.99:
            raise SystemExit(f"Only {overlap_pct:.4f}% of the DTM is covered by the orthophoto.")

        elevation = dem.read(1, masked=True)
        if np.ma.getmaskarray(elevation).any():
            # Preserve NoData values in the binary grid; the browser sampler will reject them.
            raw = elevation.filled(float(dem.nodata)).astype("<f4", copy=False)
        else:
            raw = np.asarray(elevation, dtype="<f4")
        dem_binary = OUTPUT_DIR / "jezero-ctx-dem-f32le.bin"
        raw.tofile(dem_binary)

        source_image = ortho.read(1)
        rgba = np.empty((ortho.height, ortho.width, 4), dtype=np.uint8)
        rgba[:, :, 0] = source_image
        rgba[:, :, 1] = source_image
        rgba[:, :, 2] = source_image
        nodata = ortho.nodata
        rgba[:, :, 3] = 0 if nodata is None else np.where(source_image == nodata, 0, 255)
        ortho_png = OUTPUT_DIR / "jezero-ctx-orthophoto.png"
        Image.fromarray(rgba, mode="RGBA").save(ortho_png, optimize=True)

        def product_metadata(dataset: rasterio.io.DatasetReader, source: Path) -> dict:
            b = dataset.bounds
            return {
                "sourceFile": source.name,
                "width": dataset.width,
                "height": dataset.height,
                "bands": dataset.count,
                "dataType": dataset.dtypes[0],
                "resolutionMeters": [abs(dataset.transform.a), abs(dataset.transform.e)],
                "transform": [
                    dataset.transform.a,
                    dataset.transform.b,
                    dataset.transform.c,
                    dataset.transform.d,
                    dataset.transform.e,
                    dataset.transform.f,
                ],
                "boundsProjectedMeters": {
                    "west": b.left,
                    "south": b.bottom,
                    "east": b.right,
                    "north": b.top,
                },
                "boundsDegrees": raster_bounds_lonlat(b),
                "noData": dataset.nodata,
            }

        valid = np.asarray(elevation.compressed(), dtype=np.float64)
        metadata = {
            "region": "Jezero Crater, Mars",
            "source": "USGS Astrogeology / NASA Mars 2020 Terrain Relative Navigation CTX products",
            "attribution": "JPL-Caltech / NASA / USGS Astrogeology Science Center",
            "sourceCrs": dem.crs.to_string(),
            "projection": "Equirectangular (spherical Mars; positive-east longitude)",
            "proj4": projection,
            "marsRadiusMeters": MARS_RADIUS_M,
            "coordinateConvention": "planetocentric latitude, positive-east longitude; degrees in app",
            "elevationReference": "MOLA topography / delta geoid as specified by the CTX DTM product",
            "heightUnits": "metres",
            "dem": {
                **product_metadata(dem, dem_path),
                "browserFile": dem_binary.name,
                "byteOrder": "little-endian",
                "validElevationMinMeters": float(valid.min()),
                "validElevationMaxMeters": float(valid.max()),
            },
            "orthophoto": {
                **product_metadata(ortho, ortho_path),
                "browserFile": ortho_png.name,
                "encoding": "source 8-bit grayscale copied to RGB; source NoData pixels have alpha 0",
            },
            "verifiedOverlapPercentOfDem": overlap_pct,
            "verifiedIntersectionProjectedMeters": {
                "west": left,
                "south": bottom,
                "east": right,
                "north": top,
            },
            "sources": {
                "dem": "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif",
                "orthophoto": "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif",
                "productPage": "https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic",
            },
        }
        (OUTPUT_DIR / "jezero-ctx-metadata.json").write_text(
            json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
        )

    print(f"Prepared verified CTX pair ({overlap_pct:.4f}% DTM coverage):")
    print(f"  DEM: {dem_binary} ({dem_binary.stat().st_size:,} bytes)")
    print(f"  Orthophoto: {ortho_png} ({ortho_png.stat().st_size:,} bytes)")
    print(f"  Metadata: {OUTPUT_DIR / 'jezero-ctx-metadata.json'}")


if __name__ == "__main__":
    main()
