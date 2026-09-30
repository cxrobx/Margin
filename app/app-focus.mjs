import { createRequire } from 'node:module';
let bridge;
if (process.platform === 'darwin') {
  try { bridge = createRequire(import.meta.url)('./native/glass.node'); } catch { /* Shortcuts then reach the previous app. */ }
}

// The panel is a non-activating window, so it can hold keyboard focus while
// another app stays active and receives ⌘V, ⌘C, ⌘Z. Activate Margin while it
// is open; when it closes, the bridge gives focus back to the app active
// before Margin, unless the user has since moved to another app.
export class AppFocus {
  constructor(options = {}) { this.bridge = 'bridge' in options ? options.bridge : bridge; }
  activate() { this.bridge?.activate?.(); }
  restore() { return Boolean(this.bridge?.restore?.()); }
}
