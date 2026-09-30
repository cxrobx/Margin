import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import NodeIcon, { BUILTIN_ICONS, iconLabel, iconStyle } from './NodeIcon.jsx';
import { ICON_HUES, isImageIcon } from '../shared/icons.mjs';

// Each successful pick is saved immediately, as in CXTasks. Serialize writes
// so a slow save cannot overwrite a later click or a note's content revision.
export default function IconPicker({ target, close, api }) {
  const [appearance, setAppearance] = useState({ icon: target.icon ?? null, iconColor: target.iconColor ?? null });
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const revision = useRef(target.revision);
  const dialog = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.querySelector('button')?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key === 'Tab') {
        const nodes = [...dialog.current.querySelectorAll('button:not(:disabled)')].filter(node => node.getClientRects().length);
        const first = nodes[0], last = nodes.at(-1);
        if (!nodes.includes(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { mounted.current = false; document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  const save = async next => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await target.save(next, revision.current);
      if (!mounted.current) return;
      if (!result.ok) { setError(result.error); return; }
      revision.current = result.value?.revision ?? revision.current;
      setAppearance(next);
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const chooseImage = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    let result;
    try { result = await api.chooseIcon(); }
    catch (e) { result = { ok: false, error: e.message }; }
    pending.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    if (!result.value?.length) return;
    setCandidates(result.value);
    if (result.value.length === 1) await save({ ...appearance, icon: result.value[0].dataUrl });
  };
  return <div className="icon-picker-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialog} className="icon-picker" role="dialog" aria-modal="true" aria-labelledby="icon-picker-title" aria-busy={busy}>
      <header><div><h2 id="icon-picker-title">Icon &amp; color</h2><p>{target.name}</p></div><button className="icon-button" aria-label="Close icon picker" onClick={close}><X size={16} /></button></header>
      <div className="icon-picker-preview"><NodeIcon {...appearance} fallback={target.fallback} size={20} /><span>{target.name}</span>{busy && <Loader2 className="icon-saving" size={13} aria-label="Saving appearance" />}</div>
      <button className="icon-choose-image" aria-label="Choose image…" disabled={busy} onClick={chooseImage}><ImagePlus size={14} />Choose image…</button>
      {candidates.length > 0 && <div className="icon-image-grid">{candidates.map(candidate => <button key={candidate.dataUrl} disabled={busy} title={candidate.label} aria-label={candidate.label} aria-pressed={appearance.icon === candidate.dataUrl} onClick={() => save({ ...appearance, icon: candidate.dataUrl })}><img src={candidate.dataUrl} alt="" draggable={false} /><span>{candidate.cutout ? 'No background' : 'Original'}</span></button>)}</div>}
      <h3>Built-in</h3><div className="icon-glyph-grid">{Object.entries(BUILTIN_ICONS).map(([name, Glyph]) => <button key={name} disabled={busy} title={iconLabel(name)} aria-label={`Use ${iconLabel(name)} icon`} aria-pressed={appearance.icon === `lucide:${name}`} onClick={() => save({ ...appearance, icon: `lucide:${name}` })}><Glyph size={16} style={iconStyle(appearance.iconColor)} /></button>)}</div>
      <h3>Color <span>{isImageIcon(appearance.icon) ? 'Images keep their own colors' : 'Built-in icons'}</span></h3>
      <div className="icon-color-grid"><button className="icon-color-auto" disabled={busy} title="Automatic" aria-label="Automatic icon color" aria-pressed={!appearance.iconColor} onClick={() => save({ ...appearance, iconColor: null })}>A</button>{ICON_HUES.map(hue => <button key={hue} disabled={busy} title={hue} aria-label={`${hue} icon color`} aria-pressed={appearance.iconColor === hue} style={{ background: `var(--icon-${hue})` }} onClick={() => save({ ...appearance, iconColor: hue })} />)}</div>
      {error && <p className="icon-picker-error" role="alert">{error}</p>}
      <footer><span role="status" aria-live="polite">{busy ? 'Saving…' : 'Saved automatically'}</span><button disabled={busy} onClick={() => save({ icon: null, iconColor: null })}>Reset to default</button></footer>
    </section>
  </div>;
}
