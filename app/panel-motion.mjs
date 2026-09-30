// The renderer slides the complete panel inside a transparent native window.
// Its fixed viewport clips motion at this display's edge, including when a
// second monitor sits beside it. Desktop blur stays active during motion; the native shadow returns on arrival.
export class PanelMotion {
  constructor(win, { reducedMotion, hidden, material }) {
    this.material = material; this.win = win; this.reducedMotion = reducedMotion; this.hidden = hidden;
    this.visible = false; this.phase = 'closed'; this.id = 0;
  }
  request(visible, edge) {
    if (visible === this.visible && this.phase !== 'closed') {
      if (visible && this.win.isVisible()) this.win.focus();
      return;
    }
    if (!visible && this.phase === 'closed') return;
    clearTimeout(this.timeout);
    this.visible = visible;
    this.phase = 'preparing';
    const id = ++this.id;
    this.win.setHasShadow(false);
    this.material.beginMotion();
    this.win.webContents.setBackgroundThrottling(false);
    this.win.webContents.send('panel:motion-prepare', {
      id, visible, edge, fromHidden: !this.win.isVisible(),
      duration: this.reducedMotion() ? 0 : visible ? 280 : 220
    });
    // A renderer reload or an interrupted animation must not strand the panel.
    this.timeout = setTimeout(() => this.finish(id), 1200);
  }
  ready(id) {
    if (id !== this.id || this.phase !== 'preparing') return;
    this.phase = this.visible ? 'opening' : 'closing';
    if (this.visible) { this.win.show(); this.win.focus(); }
    this.material.resume();
    this.win.webContents.send('panel:motion-start', id);
  }
  finish(id) {
    if (id !== this.id || this.phase === 'open' || this.phase === 'closed') return;
    clearTimeout(this.timeout);
    this.win.webContents.send('panel:motion-settle', { id, visible: this.visible });
    if (this.visible) {
      this.win.show(); this.phase = 'open';
    } else {
      this.phase = 'closed'; this.win.hide(); this.hidden();
    }
    this.win.setHasShadow(true);
    if (this.visible) this.material.resume(); else this.material.suspend();
    this.material.endMotion();
    this.win.webContents.setBackgroundThrottling(true);
  }
  dispose() { clearTimeout(this.timeout); }
}
