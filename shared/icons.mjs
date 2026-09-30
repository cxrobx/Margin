// Stored names match CXTasks, so a newer glyph can safely fall back on older builds.
export const IMAGE_ICON_PREFIX = 'data:image/png;base64,';
export const ICON_HUES = ['blue', 'red', 'green', 'orange', 'amber', 'purple', 'teal', 'pink', 'sand', 'grey'];
export const isImageIcon = icon => typeof icon === 'string' && icon.startsWith(IMAGE_ICON_PREFIX);

export function validImageIcon(value) {
  if (!isImageIcon(value) || value.length > 90_000) return false;
  const encoded = value.slice(IMAGE_ICON_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4) return false;
  const png = Buffer.from(encoded, 'base64');
  return png.length >= 45 && png.length <= 65_536 && png.toString('base64') === encoded
    && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && png.readUInt32BE(8) === 13 && png.toString('ascii', 12, 16) === 'IHDR'
    && png.readUInt32BE(16) > 0 && png.readUInt32BE(16) <= 256
    && png.readUInt32BE(20) > 0 && png.readUInt32BE(20) <= 256
    && png.toString('ascii', png.length - 8, png.length - 4) === 'IEND';
}
