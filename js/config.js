/**
 * Shared gameplay / performance knobs.
 * Tuned for dense traffic without main-thread hangs.
 */

export const TRAFFIC_COUNT = 227; // ~10% below prior 252 density
export const TRAFFIC_SPAWN_BATCH = 2;
export const TRAFFIC_ACTIVE_DIST = 68;
export const TRAFFIC_ACTIVE_DIST2 = TRAFFIC_ACTIVE_DIST * TRAFFIC_ACTIVE_DIST;
export const TRAFFIC_HIDE_DIST2 = 105 * 105;
/** Far cars update every Nth frame (scaled dt). */
export const TRAFFIC_FAR_STRIDE = 5;

/** Soft limit for traffic AI work per frame (ms). */
export const TRAFFIC_FRAME_BUDGET_MS = 5.5;

/** Cap device pixel ratio — high DPR tanks GPU fill-rate. */
export const MAX_PIXEL_RATIO = Math.min(
  typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  1.1
);

/** Building facade canvas size (was 512×1024 — cut for faster boot). */
export const BUILDING_TEX_W = 256;
export const BUILDING_TEX_H = 512;

/** Road asphalt canvas size (was 1024). */
export const ASPHALT_TEX_SIZE = 512;
