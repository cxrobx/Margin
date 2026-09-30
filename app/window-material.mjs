import { createRequire } from 'node:module';
import { GLASS_THEME, glassAlphas } from '../shared/themes.mjs';
let bridge;
if (process.platform === 'darwin') {
  try { bridge = createRequire(import.meta.url)('./native/glass.node'); } catch { /* Native vibrancy remains available. */ }
}

export class WindowMaterial {
  constructor(win, nativeTheme, options = {}) {
    this.win = win; this.nativeTheme = nativeTheme;
    this.platform = options.platform ?? process.platform; this.bridge = options.bridge ?? bridge;
    this.suspended = true; this.moving = false; this.status = { backend: 'none', radius: 0 };
  }
  update(settings) { this.settings = settings; this.render(); }
  suspend() { this.suspended = true; this.render(); }
  resume() { this.suspended = false; this.render(); }
  beginMotion() { this.moving = true; this.render(); }
  endMotion() { this.moving = false; this.render(); }
  render(force = false) {
    if (this.win.isDestroyed() || !this.settings) return;
    const reduced = this.nativeTheme.prefersReducedTransparency;
    const glass = this.settings.themeId === GLASS_THEME.id;
    const mode = this.nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    const radius = glass && !this.suspended ? glassAlphas(this.settings.glassTransparency, mode, reduced).radius : 0;
    const mac = this.platform === 'darwin';
    const nativeBlur = mac && this.bridge?.available();
    // Desktop blur follows the renderer's nontransparent pixels. Vibrancy fills
    // the native window, so only that fallback must wait for the panel to settle.
    const key = `${glass}/${radius}/${this.suspended}/${reduced}/${radius > 0 && nativeBlur ? false : this.moving}`;
    if (!force && this.key === key) return;
    if (mac) this.win.setVibrancy(null);
    let applied = false;
    if (nativeBlur) applied = this.bridge.configure(this.win.getNativeWindowHandle(), radius) === 0;
    let backend = 'none';
    if (radius > 0 && applied) backend = 'desktop-blur';
    else if (mac && !this.suspended && !this.moving && !reduced && (!glass || radius > 0)) { this.win.setVibrancy('sidebar'); backend = 'vibrancy'; }
    // A window may not have a WindowServer number until it is first shown.
    // Leave failed native applications retryable when it becomes visible.
    this.key = nativeBlur && !applied ? null : key;
    this.status = { backend, radius: backend === 'desktop-blur' ? radius : 0, reducedTransparency: reduced };
  }
}
