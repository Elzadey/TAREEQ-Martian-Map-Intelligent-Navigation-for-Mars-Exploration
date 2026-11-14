// Computer-graphics line drawing used for the dashed route lines.
// Everything here works on integer pixel coordinates (screen space).

export type Pixel = [number, number];

// Bresenham's line algorithm (integer-only, all octants).
// Returns every pixel from (x0, y0) to (x1, y1), both included.
export function bresenham(x0: number, y0: number, x1: number, y1: number): Pixel[] {
  const pixels: Pixel[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy; // error term
  let x = x0;
  let y = y0;
  for (;;) {
    pixels.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pixels;
}

// Rasterises a polyline: Bresenham between every pair of consecutive vertices
// (the shared vertex pixel is not repeated).
export function polylinePixels(points: Pixel[]): Pixel[] {
  const out: Pixel[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = bresenham(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    for (let k = i === 0 ? 0 : 1; k < seg.length; k++) out.push(seg[k]);
  }
  if (points.length === 1) out.push(points[0]);
  return out;
}

// Dash pattern on a pixel run: `on` pixels drawn, `off` pixels skipped, repeating.
export function dashPixels(pixels: Pixel[], on: number, off: number, phase = 0): Pixel[] {
  const period = on + off;
  const out: Pixel[] = [];
  for (let i = 0; i < pixels.length; i++) {
    if ((((i + phase) % period) + period) % period < on) out.push(pixels[i]);
  }
  return out;
}

// Liang-Barsky line clipping against the rectangle [xmin,xmax] x [ymin,ymax].
// Returns the clipped segment (rounded to pixels) or null if it is fully outside.
// Used so we never rasterise millions of off-screen pixels when zoomed in.
export function clipLine(
  x0: number, y0: number, x1: number, y1: number,
  xmin: number, ymin: number, xmax: number, ymax: number,
): [number, number, number, number] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // parallel and outside
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [Math.round(x0 + t0 * dx), Math.round(y0 + t0 * dy), Math.round(x0 + t1 * dx), Math.round(y0 + t1 * dy)];
}

// Clip every segment to the viewport, then rasterise with Bresenham.
export function rasterisePolyline(points: Pixel[], width: number, height: number, margin = 20): Pixel[] {
  const out: Pixel[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const c = clipLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], -margin, -margin, width + margin, height + margin);
    if (!c) continue;
    const seg = bresenham(c[0], c[1], c[2], c[3]);
    for (const px of seg) out.push(px);
  }
  return out;
}
