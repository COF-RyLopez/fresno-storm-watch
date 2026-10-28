/** Ground plane -> screen for a flat (local) scene: a plane maps to the screen by a homography. */

/** Square (0,0),(1,0),(1,1),(0,1) -> screen quad [x0,y0, x1,y1, x2,y2, x3,y3] (Heckbert's closed form). Returns (s,t) -> [x, y, w]; w <= 0 is behind the camera. */
export function squareToQuad([x0, y0, x1, y1, x2, y2, x3, y3]) {
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return (s, t) => { const w = g * s + h * t + 1; return [(a * s + b * t + x0) / w, (d * s + e * t + y0) / w, w]; };
}
