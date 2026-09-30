import { createRequire } from 'node:module';
let bridge;
if (process.platform === 'darwin') {
  try { bridge = createRequire(import.meta.url)('./native/glass.node'); } catch { /* Shortcuts then reach the previous app. */ }
}

// The panel is a non-activating window, so it can hold keyboard focus while
// another app stays active and receives ⌘V, ⌘C, ⌘Z. Activate Margin while it
// is open and give focus back to the previous app when it closes.
export class AppFocus {
  constructor(options = {}) { this.bridge = 'bridge' in options ? options.bridge : bridge; this.previous = 0; }
  activate() {
    if (!this.bridge?.activate) return;
    const front = this.bridge.frontmost();
    if (front > 0) this.previous = front;
    this.bridge.activate();
  }
  restore() {
    const previous = this.previous; this.previous = 0;
    if (previous > 0) this.bridge?.restore?.(previous);
  }
}
