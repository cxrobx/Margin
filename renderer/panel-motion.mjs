export function installPanelMotion(api) {
  if (!api) return;
  const root = document.getElementById('root');
  let motion, animation;
  const freeze = () => {
    const transform = getComputedStyle(root).transform;
    animation?.cancel(); animation = null;
    root.style.transform = transform === 'none' ? 'translateX(0)' : transform;
  };
  api.onPanelPrepare(next => {
    freeze();
    motion = next;
    motion.offscreen = `translateX(${next.edge === 'left' ? '-' : ''}101%)`;
    if (next.fromHidden) root.style.transform = motion.offscreen;
    root.dataset.panelMotion = next.visible ? 'opening' : 'closing';
    root.style.willChange = 'transform';
    // Resolve this style before the native window becomes visible.
    root.getBoundingClientRect();
    api.panelPrepared(next.id);
  });
  api.onPanelStart(id => {
    if (motion?.id !== id) return;
    const target = motion.visible ? 'translateX(0)' : motion.offscreen;
    const current = getComputedStyle(root).transform;
    const distance = Math.abs(new DOMMatrixReadOnly(current).m41 - (motion.visible ? 0 : root.clientWidth * 1.01 * (motion.edge === 'left' ? -1 : 1)));
    const duration = motion.duration * Math.min(1, distance / (root.clientWidth * 1.01));
    if (!duration || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.style.transform = target; api.panelFinished(id); return;
    }
    animation = root.animate([{ transform: current }, { transform: target }], {
      duration, easing: motion.visible ? 'cubic-bezier(.22, 1, .36, 1)' : 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards'
    });
    animation.finished.then(() => {
      if (motion?.id !== id) return;
      root.style.transform = target;
      animation.cancel(); animation = null;
      api.panelFinished(id);
    }).catch(() => {}); // Reversing direction cancels the superseded animation.
  });
  api.onPanelSettle(({ id, visible }) => {
    if (motion?.id !== id) return;
    animation?.cancel(); animation = null;
    root.style.transform = visible ? 'translateX(0)' : motion.offscreen;
    root.style.willChange = 'auto';
    root.dataset.panelMotion = visible ? 'open' : 'closed';
  });
}
