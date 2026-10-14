// Post-capture photo handling. The camera's original file can carry EXIF (device, time,
// sometimes location), so it is re-encoded and deleted straight away (app/CLAUDE.md §3.5):
//   - review copy: JPEG, longest side <= 1280 px, shown on the review/result screens;
//   - analysis copy: JPEG, longest side <= 640 px, decoded to pixels for the quality gate
//     (and later the detector), then deleted.
// Both live only in the app's private cache — never the gallery — and the review copy is
// deleted when the screening session ends. Nothing here touches the network.
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';

import type { PixelImage } from './quality-gate';

export const REVIEW_MAX_SIDE = 1280;
export const ANALYSIS_MAX_SIDE = 640;

export type RawPhoto = { uri: string; width: number; height: number };
export type PreparedPhoto = { uri: string; width: number; height: number; pixels: PixelImage };
export type CropRect = { originX: number; originY: number; width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Maps the on-screen capture frame to photo pixels, grown by `margin` (fraction of the frame
 * per side) so lips and gums stay in view, clamped to the photo. The preview must show the
 * whole photo at the same aspect ratio (camera view sized 3:4 with ratio "4:3"); if the aspects
 * differ (e.g. a landscape photo) it returns null and the full photo is used.
 */
export function frameToCrop(photo: { width: number; height: number }, view: Rect, frame: Rect, margin = 0.3): CropRect | null {
  if (photo.width <= 0 || photo.height <= 0 || view.width <= 0 || view.height <= 0) return null;
  if (Math.abs(photo.width / photo.height - view.width / view.height) > 0.03) return null;
  const scale = photo.width / view.width;
  const mx = frame.width * margin;
  const my = frame.height * margin;
  const x0 = Math.max(0, Math.floor((frame.x - view.x - mx) * scale));
  const y0 = Math.max(0, Math.floor((frame.y - view.y - my) * scale));
  const x1 = Math.min(photo.width, Math.ceil((frame.x - view.x + frame.width + mx) * scale));
  const y1 = Math.min(photo.height, Math.ceil((frame.y - view.y + frame.height + my) * scale));
  if (x1 - x0 < 32 || y1 - y0 < 32) return null;
  return { originX: x0, originY: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Smallest 4:3 capture size whose long side is >= `minLongSide` ("4000x3000"-style strings).
 * A 12 MP capture costs seconds on a 3 GB phone and is downsized to 1280 px anyway.
 */
export function choosePictureSize(sizes: readonly string[], minLongSide = 1600): string | undefined {
  const parsed = sizes
    .map((s) => {
      const m = /^(\d+)x(\d+)$/.exec(s.trim());
      if (!m) return null;
      const a = Number(m[1]);
      const b = Number(m[2]);
      return { s, long: Math.max(a, b), ratio: Math.max(a, b) / Math.min(a, b) };
    })
    .filter((p): p is { s: string; long: number; ratio: number } => !!p && Math.abs(p.ratio - 4 / 3) < 0.02);
  const bigEnough = parsed.filter((p) => p.long >= minLongSide).sort((a, b) => a.long - b.long);
  return bigEnough[0]?.s;
}

/** Resize target for the longest side, never upscaling. */
export function fitLongestSide(width: number, height: number, maxSide: number): { width?: number; height?: number } {
  if (Math.max(width, height) <= maxSide) return width >= height ? { width } : { height };
  return width >= height ? { width: maxSide } : { height: maxSide };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeJpeg(bytes: Uint8Array): PixelImage & { hasExif: boolean } {
  const img = decode(bytes, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
  return {
    width: img.width,
    height: img.height,
    channels: 3,
    data: img.data,
    hasExif: Boolean((img as { exifBuffer?: Uint8Array }).exifBuffer),
  };
}

/** Deletes a temporary photo; a missing file or web blob URL is not an error. */
export function discardPhoto(uri: string | null | undefined): void {
  if (!uri || process.env.EXPO_OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache files are also cleared by the OS; never crash the flow over cleanup.
  }
}

async function reencode(
  uri: string,
  size: { width?: number; height?: number },
  compress: number,
  base64: boolean,
  crop?: CropRect | null,
) {
  const context = ImageManipulator.manipulate(uri);
  if (crop) context.crop(crop);
  const image = await context.resize(size).renderAsync();
  try {
    return await image.saveAsync({ format: SaveFormat.JPEG, compress, base64 });
  } finally {
    image.release();
    context.release();
  }
}

/** Crops (optional) to the mouth region, strips metadata, downsizes and decodes for the gate. */
export async function preparePhoto(raw: RawPhoto, crop?: CropRect | null): Promise<PreparedPhoto> {
  let reviewUri: string | null = null;
  const source = crop ?? { originX: 0, originY: 0, width: raw.width, height: raw.height };
  try {
    const review = await reencode(
      raw.uri,
      fitLongestSide(source.width, source.height, REVIEW_MAX_SIDE),
      0.85,
      false,
      crop,
    );
    reviewUri = review.uri;
    const analysis = await reencode(
      review.uri,
      fitLongestSide(review.width, review.height, ANALYSIS_MAX_SIDE),
      0.92,
      true,
    );
    discardPhoto(analysis.uri);
    if (!analysis.base64) throw new Error('analysis image has no pixel data');
    const { hasExif, ...pixels } = decodeJpeg(base64ToBytes(analysis.base64));
    if (__DEV__ && hasExif) console.warn('[screening] re-encoded photo still carries EXIF');
    return { uri: review.uri, width: review.width, height: review.height, pixels };
  } catch (error) {
    discardPhoto(reviewUri);
    throw error;
  } finally {
    discardPhoto(raw.uri);
  }
}
