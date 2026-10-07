/**
 * Main-thread / frame helpers — keep gameplay + graphics from hitching.
 */

/** Yield so the browser can paint the loading bar / stay responsive. */
export function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Simple per-frame time budget. */
export class FrameBudget {
  constructor(limitMs = 6) {
    this.limitMs = limitMs;
    this.t0 = 0;
  }

  begin(limitMs) {
    if (limitMs != null) this.limitMs = limitMs;
    this.t0 = performance.now();
  }

  elapsed() {
    return performance.now() - this.t0;
  }

  exceeded() {
    return this.elapsed() >= this.limitMs;
  }
}

/**
 * Adaptive quality controller — drops GPU work fast when frames lag,
 * never spikes settings in a way that hitch-toggles shadows.
 */
export function createQualityController({
  renderer,
  sunLight,
  getPlayerMode,
  maxPixelRatio,
}) {
  const quality = {
    pixelRatio: maxPixelRatio,
    shadows: false,
    smoke: true,
    avgDt: 0.016,
  };
  let cooldown = 0;

  function apply() {
    renderer.setPixelRatio(quality.pixelRatio);
    const wantShadows = quality.shadows && getPlayerMode() === 1;
    if (renderer.shadowMap.enabled !== wantShadows) {
      renderer.shadowMap.enabled = wantShadows;
      sunLight.castShadow = wantShadows;
    }
  }

  function update(dt) {
    quality.avgDt = quality.avgDt * 0.9 + dt * 0.1;
    cooldown = Math.max(0, cooldown - dt);
    if (cooldown > 0) return;

    if (quality.avgDt > 0.033 || dt > 0.045) {
      if (quality.smoke) {
        quality.smoke = false;
        cooldown = 1.2;
      } else if (quality.shadows) {
        quality.shadows = false;
        cooldown = 1.6;
        apply();
      } else if (quality.pixelRatio > 1) {
        quality.pixelRatio = 1;
        cooldown = 1.8;
        apply();
      }
    } else if (quality.avgDt < 0.015 && dt < 0.018) {
      if (!quality.smoke) {
        quality.smoke = true;
        cooldown = 2;
      } else if (quality.pixelRatio < maxPixelRatio - 0.01) {
        quality.pixelRatio = Math.min(maxPixelRatio, quality.pixelRatio + 0.1);
        cooldown = 2.5;
        apply();
      }
    }
  }

  return { quality, apply, update };
}

/** Warm GPU shaders once so the first play frame does not hitch. */
export function warmRenderer(renderer, scene, camera) {
  try {
    renderer.compile(scene, camera);
  } catch (_) {
    /* ignore — older three builds */
  }
}
