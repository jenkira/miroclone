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

/** Returns the viewport that shows `rect` centred in a `width` by `height` screen, with padding (CNV-1). */
export function fitRect(rect: { x: number; y: number; width: number; height: number }, width: number, height: number, pad = 48): Viewport {
  const zoom = clampZoom(Math.min((width - pad * 2) / Math.max(rect.width, 1), (height - pad * 2) / Math.max(rect.height, 1)));
  return { zoom, x: width / 2 - (rect.x + rect.width / 2) * zoom, y: height / 2 - (rect.y + rect.height / 2) * zoom };
}

export interface MinimapLayout {
  /** Scale from world units to minimap pixels. */
  scale: number;
  /** World point at the minimap's top-left corner. */
  originX: number;
  originY: number;
}

/**
 * Fits the world area that holds the board and the current view into a minimap of `width` by `height` pixels,
 * centred, so the view rectangle stays on screen wherever the person pans (CNV-13).
 */
export function minimapLayout(
  content: { x: number; y: number; width: number; height: number } | undefined,
  view: { x: number; y: number; width: number; height: number },
  width: number, height: number,
): MinimapLayout {
  const x1 = Math.min(view.x, content?.x ?? view.x), y1 = Math.min(view.y, content?.y ?? view.y);
  const x2 = Math.max(view.x + view.width, content ? content.x + content.width : 0), y2 = Math.max(view.y + view.height, content ? content.y + content.height : 0);
  const w = Math.max(x2 - x1, 1), h = Math.max(y2 - y1, 1);
  const scale = Math.min(width / w, height / h);
  return { scale, originX: x1 - (width / scale - w) / 2, originY: y1 - (height / scale - h) / 2 };
}

/** The world point under a point on the minimap. */
export const minimapToWorld = (l: MinimapLayout, mx: number, my: number) => ({ x: l.originX + mx / l.scale, y: l.originY + my / l.scale });
