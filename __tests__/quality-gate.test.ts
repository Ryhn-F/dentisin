// Parity with backend/ml/detection/quality_gate.py via its parametric vectors
// (tests/quality_gate_vectors.json). The generators below are ports of quality_gate_vectors.py
// (integer arithmetic only). Vectors carry their own config snapshot, so threshold changes in
// the YAML never silently change them. Skipped outside the monorepo.
import fs from 'node:fs';
import path from 'node:path';

import { evaluateQuality, qualityConfig, type PixelImage, type QualityConfig } from '@/ml/quality-gate';

const vectorsPath = path.resolve(__dirname, '../../backend/ml/detection/tests/quality_gate_vectors.json');
const describeIfBackend = fs.existsSync(vectorsPath) ? describe : describe.skip;

type Gen = {
  type: 'uniform' | 'checker' | 'hgradient' | 'mouth' | 'mouth_soft';
  w: number;
  h: number;
  rgb?: number[];
  cell?: number;
  a?: number[];
  b?: number[];
  lip?: number[];
  tooth?: number[];
  gap?: number[];
  rect?: number[];
  period?: number;
  gap_w?: number;
  drop?: number;
  blur?: { radius: number; passes: number };
};

const clamp = (v: number) => Math.min(255, Math.max(0, v));

function renderBase(gen: Gen): PixelImage {
  const { w, h } = gen;
  const data = new Uint8Array(w * h * 3);
  const set = (x: number, y: number, px: number[]) => data.set(px.map(clamp), (y * w + x) * 3);
  const [fx0, fy0, fx1, fy1] = gen.rect ?? [0, 0, 0, 0];
  const x0 = Math.floor(w * fx0);
  const y0 = Math.floor(h * fy0);
  const x1 = Math.floor(w * fx1);
  const y1 = Math.floor(h * fy1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      switch (gen.type) {
        case 'uniform':
          set(x, y, gen.rgb!);
          break;
        case 'checker':
          set(x, y, (Math.floor(x / gen.cell!) + Math.floor(y / gen.cell!)) % 2 === 0 ? gen.a! : gen.b!);
          break;
        case 'hgradient': {
          const v = Math.floor((x * 255) / (w - 1));
          set(x, y, [v, v, v]);
          break;
        }
        default: {
          const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
          if (!inside) {
            set(x, y, gen.lip!);
          } else if (gen.type === 'mouth') {
            set(x, y, (x - x0) % gen.period! < gen.gap_w! ? gen.gap! : gen.tooth!);
          } else {
            const p = gen.period!;
            const tri = Math.abs(((x - x0) % p) - Math.floor(p / 2));
            set(x, y, gen.tooth!.map((c) => c - Math.floor((gen.drop! * tri) / Math.floor(p / 2))));
          }
        }
      }
    }
  }
  return { width: w, height: h, channels: 3, data };
}

/** n passes of a (2r+1)^2 box mean per channel, edge-replicated, round-half-up. */
function boxBlur(img: PixelImage, radius: number, passes: number): PixelImage {
  const { width: w, height: h } = img;
  const area = (2 * radius + 1) ** 2;
  let src = img.data;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = -radius; dy <= radius; dy++) {
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            for (let dx = -radius; dx <= radius; dx++) {
              const xx = Math.min(w - 1, Math.max(0, x + dx));
              sum += src[(yy * w + xx) * 3 + c];
            }
          }
          out[(y * w + x) * 3 + c] = Math.floor((sum + Math.floor(area / 2)) / area);
        }
      }
    }
    src = out;
  }
  return { ...img, data: src };
}

function render(gen: Gen): PixelImage {
  const img = renderBase(gen);
  return gen.blur ? boxBlur(img, gen.blur.radius, gen.blur.passes) : img;
}

function toRgba(img: PixelImage): PixelImage {
  const data = new Uint8Array(img.width * img.height * 4);
  for (let p = 0; p < img.width * img.height; p++) {
    data.set(img.data.subarray(p * 3, p * 3 + 3), p * 4);
    data[p * 4 + 3] = 255;
  }
  return { ...img, channels: 4, data };
}

function expectClose(actual: number, expected: number, abs: number, rel: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(abs, rel * Math.abs(expected)));
}

describeIfBackend('quality gate parity (quality_gate_vectors.json)', () => {
  const file = JSON.parse(fs.readFileSync(vectorsPath, 'utf8')) as {
    version: number;
    tolerance: { abs: number; rel: number };
    config: QualityConfig;
    vectors: { id: string; gen: Gen; expected: { passed: boolean; reasons: string[]; metrics: Record<string, number | string> } }[];
  };

  it('reads the vector format this port implements', () => {
    expect(file.version).toBe(1);
    expect(file.vectors.length).toBeGreaterThanOrEqual(12);
  });

  describe.each(file.vectors.map((v) => [v.id, v] as const))('%s', (_id, v) => {
    const img = render(v.gen);

    it.each([
      ['RGB', img],
      ['RGBA', toRgba(img)],
    ])('matches the reference (%s input)', (_layout, input) => {
      const res = evaluateQuality(input, file.config);
      expect(res.passed).toBe(v.expected.passed);
      expect(res.reasons).toEqual(v.expected.reasons);
      expect(res.config_status).toBe(file.config.status);
      for (const [key, expected] of Object.entries(v.expected.metrics)) {
        const actual = res.metrics[key as keyof typeof res.metrics];
        if (typeof expected === 'number') expectClose(actual as number, expected, file.tolerance.abs, file.tolerance.rel);
        else expect(actual).toBe(expected);
      }
    });
  });
});

describe('quality gate units', () => {
  it('ships a PLACEHOLDER config (release builds must refuse it)', () => {
    expect(qualityConfig.status).toBe('PLACEHOLDER');
    expect(qualityConfig.working_size.max_side).toBeGreaterThan(0);
  });

  it('rejects empty and truncated buffers', () => {
    expect(() => evaluateQuality({ width: 0, height: 0, channels: 3, data: new Uint8Array() })).toThrow('empty image');
    expect(() => evaluateQuality({ width: 4, height: 4, channels: 3, data: new Uint8Array(10) })).toThrow(
      'pixel buffer too small',
    );
  });

  it('returns zero blur variance for images under 3x3', () => {
    const res = evaluateQuality({ width: 2, height: 2, channels: 3, data: new Uint8Array(12).fill(200) });
    expect(res.metrics.laplacian_var).toBe(0);
    expect(res.reasons).toContain('blurry');
  });
});
