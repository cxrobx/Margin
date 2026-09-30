import { nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IMAGE_ICON_PREFIX, validImageIcon } from '../shared/icons.mjs';

// Freeze imported images into small PNGs; never depend on the original path.
export async function iconCandidates(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Choose a PNG or JPEG image up to 5 MB.');
  let image = nativeImage.createFromBuffer(await fs.readFile(file));
  if (image.isEmpty()) throw new Error('This image could not be read. Choose a PNG or JPEG.');
  const size = image.getSize();
  if (size.width > 4096 || size.height > 4096) throw new Error('Choose an image no larger than 4096 pixels on each side.');
  if (Math.max(size.width, size.height) > 512) image = image.resize({ ...(size.width >= size.height ? { width: 512 } : { height: 512 }), quality: 'best' });
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap({ scaleFactor: 1 });
  const finish = pixels => {
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 16) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    }
    if (right < left) return null;
    const w = right - left + 1, h = bottom - top + 1, side = Math.max(w, h);
    const square = Buffer.alloc(side * side * 4);
    const x = Math.floor((side - w) / 2), y = Math.floor((side - h) / 2);
    for (let row = 0; row < h; row++) pixels.copy(square, ((row + y) * side + x) * 4, ((row + top) * width + left) * 4, ((row + top) * width + left + w) * 4);
    const png = nativeImage.createFromBitmap(square, { width: side, height: side }).resize({ width: 64, height: 64, quality: 'best' }).toPNG();
    const url = IMAGE_ICON_PREFIX + png.toString('base64');
    return validImageIcon(url) ? url : null;
  };
  const label = path.basename(file), original = finish(bitmap);
  if (!original) throw new Error('This image has no visible pixels.');
  const out = [{ label, dataUrl: original, cutout: false }];
  const corners = [0, width - 1, (height - 1) * width, width * height - 1].map(pixel => pixel * 4);
  const distance = offset => Math.max(...[0, 1, 2].map(channel => Math.abs(bitmap[offset + channel] - bitmap[channel])));
  if (corners.every(offset => bitmap[offset + 3] === 255 && distance(offset) < 12)) {
    const cut = Buffer.from(bitmap);
    for (let offset = 0; offset < bitmap.length; offset += 4) {
      const d = distance(offset), alpha = bitmap[offset + 3];
      if (d < 88) {
        const factor = Math.max(0, (d - 48) / 40);
        cut[offset + 3] = Math.round(alpha * factor);
        // Native bitmaps use premultiplied channels on this Mac.
        for (let channel = 0; channel < 3; channel++) cut[offset + channel] = Math.round(bitmap[offset + channel] * factor);
      }
    }
    const cutout = finish(cut);
    if (cutout && cutout !== original) out.push({ label: `${label} · no background`, dataUrl: cutout, cutout: true });
  }
  return out;
}
