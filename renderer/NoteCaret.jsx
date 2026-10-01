import React, { useEffect, useRef } from 'react';

// Draw a wider caret without touching the editor's native selection or text.
export default function NoteCaret({ card, bodyCaret, suspended }) {
  const cursor = useRef(null);
  const measureBody = useRef(bodyCaret); measureBody.current = bodyCaret;
  useEffect(() => {
    if (suspended || !card.current) return;
    const root = card.current, caret = cursor.current;
    const mirror = document.createElement('span');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none;';
    document.body.append(mirror);
    let frame = 0, compositionTimer = null, composing = false, target = null;
    const hide = () => {
      caret.hidden = true;
      target?.classList.remove('has-note-caret'); target = null;
    };
    const update = () => {
      frame = 0;
      const focused = document.activeElement;
      if (composing || !document.hasFocus() || !root.contains(focused) || !focused.matches('.editor-title, .rich-body')) { hide(); return; }
      let rect;
      if (focused.matches('.editor-title')) {
        if (focused.selectionStart !== focused.selectionEnd) { hide(); return; }
        const style = getComputedStyle(focused), inputRect = focused.getBoundingClientRect();
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontKerning', 'letterSpacing', 'textTransform', 'direction']) mirror.style[property] = style[property];
        mirror.textContent = focused.value || '\u200b';
        const range = document.createRange();
        range.setStart(mirror.firstChild, focused.selectionStart || 0); range.collapse(true);
        const textRect = range.getBoundingClientRect();
        const top = inputRect.top + (inputRect.height - textRect.height) / 2;
        rect = { left: inputRect.left + focused.clientLeft + parseFloat(style.paddingLeft) + textRect.left - focused.scrollLeft, top, bottom: top + textRect.height };
      } else rect = measureBody.current();
      if (!rect || rect.bottom <= rect.top) { hide(); return; }
      let top = rect.top, bottom = rect.bottom, left = rect.left;
      for (let ancestor = focused; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (!/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) continue;
        const bounds = ancestor.getBoundingClientRect();
        if (left < bounds.left || left > bounds.right) { hide(); return; }
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
      }
      if (bottom <= top) { hide(); return; }
      const bounds = root.getBoundingClientRect();
      if (target !== focused) { hide(); target = focused; }
      if (!target.classList.contains('has-note-caret')) target.classList.add('has-note-caret');
      caret.style.left = `${left - bounds.left - root.clientLeft - 1}px`;
      caret.style.top = `${top - bounds.top - root.clientTop}px`;
      caret.style.height = `${bottom - top}px`;
      caret.hidden = false;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const moved = () => { caret.getAnimations().forEach(animation => { animation.currentTime = 0; }); schedule(); };
    const beginComposition = () => { composing = true; hide(); };
    const endComposition = () => {
      composing = false; moved();
      // ProseMirror clears its composing flag after the DOM event. Measure
      // again after that cleanup even when no further keystroke follows.
      clearTimeout(compositionTimer); compositionTimer = setTimeout(moved, 50);
    };
    const events = ['selectionchange', 'input', 'keydown', 'keyup', 'pointerup', 'focusin', 'focusout'];
    for (const name of events) document.addEventListener(name, moved);
    document.addEventListener('scroll', schedule, true);
    root.addEventListener('compositionstart', beginComposition);
    root.addEventListener('compositionend', endComposition);
    window.addEventListener('blur', hide); window.addEventListener('focus', moved);
    window.addEventListener('resize', schedule);
    const resize = new ResizeObserver(schedule); resize.observe(root);
    const changes = new MutationObserver(schedule); changes.observe(root, { childList: true, characterData: true, subtree: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame); clearTimeout(compositionTimer); hide(); mirror.remove(); resize.disconnect(); changes.disconnect();
      for (const name of events) document.removeEventListener(name, moved);
      document.removeEventListener('scroll', schedule, true);
      root.removeEventListener('compositionstart', beginComposition);
      root.removeEventListener('compositionend', endComposition);
      window.removeEventListener('blur', hide); window.removeEventListener('focus', moved);
      window.removeEventListener('resize', schedule);
    };
  }, [card, suspended]);
  return <span ref={cursor} className="note-caret" hidden aria-hidden="true" />;
}
