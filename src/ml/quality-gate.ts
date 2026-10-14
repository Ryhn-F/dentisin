// Photo quality gate (FR-21) — a port of backend/ml/detection/quality_gate.py: blur, brightness
// and a "teeth visible" HEURISTIC. Pure functions on 8-bit RGB(A) pixels; integer arithmetic
// where the reference uses it, float64 two-pass mean/variance elsewhere. Parity:
// __tests__/quality-gate.test.ts reproduces ml/detection/tests/quality_gate_vectors.json.
//
// The teeth check is a colour heuristic, NOT a tooth detector (white paper beside a red object
// passes; stained teeth may fail). All thresholds are PLACEHOLDER until >= 200 labelled photos.
import configJson from '@/assets/rules/quality-gate.json';

export type QualityConfig = {
  version: number;
  status: string;
  working_size: { max_side: number };
  blur: { min_laplacian_var: number };
  brightness: {
    min_mean: number;
    max_mean: number;
    dark_level: number;
    bright_level: number;
    max_dark_fraction: number;
    max_bright_fraction: number;
  };
  teeth_visible: {
    roi_fraction: number;
    tooth_min_value: number;
    tooth_max_saturation_pct: number;
    tissue_min_red_margin: number;
    min_tooth_fraction: number;
    max_tooth_fraction: number;
    min_tissue_fraction: number;
  };
};

export const qualityConfig = configJson as QualityConfig;

/** Stable reason codes, in this order (the UI maps them to Indonesian guidance). */
export const reasonOrder = ['too_dark', 'too_bright', 'blurry', 'teeth_not_visible'] as const;
export type QualityReason = (typeof reasonOrder)[number];

/** Interleaved 8-bit pixels; `channels` 3 (RGB) or 4 (RGBA, alpha ignored). */
export type PixelImage = {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array | Uint8ClampedArray;
};

export type QualityMetrics = {
  factor: number;
  working_width: number;
  working_height: number;
  laplacian_var: number;
  mean_luma: number;
  dark_fraction: number;
  bright_fraction: number;
  teeth_score: number;
  teeth_method: string;
  tooth_fraction: number;
  tissue_fraction: number;
};

export type QualityResult = {
  passed: boolean;
  reasons: QualityReason[];
  metrics: QualityMetrics;
  config_status: string;
};

/** Working RGB image (3 channels, row-major). */
type Rgb = { width: number; height: number; data: Uint8Array };

export function workingFactor(height: number, width: number, maxSide: number): number {
  return Math.max(1, Math.ceil(Math.max(height, width) / maxSide));
}

/** Integer block mean with round-half-up; drops the right/bottom remainder. Always returns RGB. */
export function blockDownsample(img: PixelImage, k: number): Rgb {
  const h = Math.floor(img.height / k) * k;
  const w = Math.floor(img.width / k) * k;
  if (h === 0 || w === 0) throw new Error('image smaller than the downsample factor');
  const ow = w / k;
  const oh = h / k;
  const out = new Uint8Array(ow * oh * 3);
  const area = k * k;
  const half = Math.floor(area / 2);
  const c = img.channels;
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < k; dy++) {
        let i = ((oy * k + dy) * img.width + ox * k) * c;
        for (let dx = 0; dx < k; dx++, i += c) {
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
        }
      }
      const o = (oy * ow + ox) * 3;
      out[o] = Math.floor((r + half) / area);
      out[o + 1] = Math.floor((g + half) / area);
      out[o + 2] = Math.floor((b + half) / area);
    }
  }
  return { width: ow, height: oh, data: out };
}

/** Integer BT.601 approximation: Y = (77 R + 150 G + 29 B + 128) >> 8. */
export function luma(img: Rgb): Int32Array {
  const n = img.width * img.height;
  const y = new Int32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    y[p] = (77 * img.data[i] + 150 * img.data[i + 1] + 29 * img.data[i + 2] + 128) >> 8;
  }
  return y;
}

/** Variance of the 3x3 Laplacian [[0,1,0],[1,-4,1],[0,1,0]] over the valid region (no padding). */
export function laplacianVariance(gray: Int32Array, width: number, height: number): number {
  if (height < 3 || width < 3) return 0;
  const vw = width - 2;
  const lap = new Int32Array(vw * (height - 2));
  let sum = 0;
  for (let y = 1, j = 0; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++, j++) {
      const i = y * width + x;
      const v = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lap[j] = v;
      sum += v;
    }
  }
  const mean = sum / lap.length;
  let sq = 0;
  for (let j = 0; j < lap.length; j++) {
    const d = lap[j] - mean;
    sq += d * d;
  }
  return sq / lap.length;
}

export function brightnessStats(gray: Int32Array, darkLevel: number, brightLevel: number) {
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    sum += v;
    if (v <= darkLevel) dark++;
    if (v >= brightLevel) bright++;
  }
  const n = gray.length;
  return { mean: sum / n, dark: dark / n, bright: bright / n };
}

/** Colour heuristic in the central ROI (offset = floor(size * (1 - fraction) / 2) per side). */
export function teethVisibility(img: Rgb, cfg: QualityConfig) {
  const t = cfg.teeth_visible;
  const dy = Math.floor((img.height * (1 - t.roi_fraction)) / 2);
  const dx = Math.floor((img.width * (1 - t.roi_fraction)) / 2);
  let total = 0;
  let tooth = 0;
  let tissue = 0;
  for (let y = dy; y < img.height - dy; y++) {
    for (let x = dx; x < img.width - dx; x++) {
      const i = (y * img.width + x) * 3;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx >= t.tooth_min_value && (mx - mn) * 100 <= t.tooth_max_saturation_pct * mx) tooth++;
      if (r - Math.max(g, b) >= t.tissue_min_red_margin) tissue++;
      total++;
    }
  }
  const n = Math.max(1, total);
  const toothFraction = tooth / n;
  const tissueFraction = tissue / n;
  const visible =
    t.min_tooth_fraction <= toothFraction &&
    toothFraction <= t.max_tooth_fraction &&
    tissueFraction >= t.min_tissue_fraction;
  return { visible, score: toothFraction, method: 'heuristic_color_v1', toothFraction, tissueFraction };
}

export function evaluateQuality(img: PixelImage, cfg: QualityConfig = qualityConfig): QualityResult {
  if (img.width < 1 || img.height < 1) throw new Error('empty image');
  if (img.data.length < img.width * img.height * img.channels) throw new Error('pixel buffer too small');
  const k = workingFactor(img.height, img.width, cfg.working_size.max_side);
  const work = blockDownsample(img, k);
  const y = luma(work);
  const lap = laplacianVariance(y, work.width, work.height);
  const br = cfg.brightness;
  const { mean, dark, bright } = brightnessStats(y, br.dark_level, br.bright_level);
  const tv = teethVisibility(work, cfg);

  const failed = new Set<QualityReason>();
  if (mean < br.min_mean || dark > br.max_dark_fraction) failed.add('too_dark');
  if (mean > br.max_mean || bright > br.max_bright_fraction) failed.add('too_bright');
  if (lap < cfg.blur.min_laplacian_var) failed.add('blurry');
  if (!tv.visible) failed.add('teeth_not_visible');
  const reasons = reasonOrder.filter((r) => failed.has(r));

  return {
    passed: reasons.length === 0,
    reasons,
    metrics: {
      factor: k,
      working_width: work.width,
      working_height: work.height,
      laplacian_var: lap,
      mean_luma: mean,
      dark_fraction: dark,
      bright_fraction: bright,
      teeth_score: tv.score,
      teeth_method: tv.method,
      tooth_fraction: tv.toothFraction,
      tissue_fraction: tv.tissueFraction,
    },
    config_status: cfg.status,
  };
}
