/** Zoom limits from CNV-1: 1% to 400%. */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 4;

export interface Viewport { x: number; y: number; zoom: number }

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zooms about a screen point, so the world point under the cursor stays fixed. */
export function zoomAt(v: Viewport, sx: number, sy: number, factor: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
}

export function screenToWorld(v: Viewport, sx: number, sy: number) {
  return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom };
}
