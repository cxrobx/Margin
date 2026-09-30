import { vaultEndpoint, parseVaultLook, parseVaultDecorations } from '../shared/themes.mjs';

async function readTheme(endpoint) {
  try {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    const reader = response.body.getReader();
    let size = 0; const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 300_000) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return null; }
}
export async function fetchVaultTheme(address) {
  const endpoint = vaultEndpoint(address);
  const [base, markdown, sidebar] = await Promise.all([
    readTheme(endpoint), readTheme(new URL('/api/markdown-theme', endpoint)), readTheme(new URL('/api/sidebar-theme', endpoint))
  ]);
  const palette = parseVaultLook(base);
  if (!palette) return null;
  const decoration = parseVaultDecorations(markdown, sidebar, palette.mode);
  if (decoration) palette.decoration = decoration;
  return palette;
}
