import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Copy, Folder, Monitor, Moon, Palette, RefreshCw, Sun, Trash2 } from 'lucide-react';
import { DEFAULT_THEME, GLASS_THEME, MONOKAI_SODA_THEME, APPEARANCE_KEYS, paletteTokens, resolveAppearance } from '../shared/themes.mjs';
import './themes.css';

function Preview({ tokens, glass = false }) {
  return <span className={`theme-preview ${glass ? 'glass-preview' : ''}`} aria-hidden="true" style={{ background: glass ? undefined : tokens.bg, color: tokens.text, borderColor: tokens.line }}>
    <span className="preview-heading">Margin<span style={{ color: tokens.green }}>＋</span></span>
    <span className="preview-card" style={{ background: tokens.sage }}><b>A little thought</b><i style={{ background: tokens.text }} /><i style={{ background: tokens.muted }} /></span>
    <span className="preview-card second" style={{ background: tokens.paper }}><i style={{ background: tokens.text }} /><i style={{ background: tokens.muted }} /></span>
  </span>;
}

export function applyAppearance(state, systemDark, reducedTransparency = false) {
  const appearance = resolveAppearance(state, systemDark, reducedTransparency);
  const root = document.documentElement;
  // Clear every override first so switching themes cannot leave old colours behind.
  for (const key of APPEARANCE_KEYS) root.style.removeProperty('--' + key);
  for (const [key, value] of Object.entries(appearance.tokens)) root.style.setProperty('--' + key, value);
  root.style.setProperty('--ui-font', appearance.font);
  root.style.setProperty('--display-font', appearance.custom ? appearance.font : 'Georgia, serif');
  root.dataset.material = appearance.material;
  root.dataset.theme = appearance.mode;
  root.dataset.customTheme = String(appearance.custom);
  root.style.colorScheme = appearance.mode;
}

export default function Themes({ state, api, act, back, reducedTransparency }) {
  const [status, setStatus] = useState({ connected: false, checkedAt: null });
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [name, setName] = useState('My vault');
  const [error, setError] = useState('');
  const [address, setAddress] = useState(state.settings.vaultAddress);
  const [transparency, setTransparency] = useState(state.settings.glassTransparency);
  const appearanceTimer = useRef(null);
  const pendingAppearance = useRef(null);
  useEffect(() => {
    if (pendingAppearance.current) return;
    setTransparency(state.settings.glassTransparency);
  }, [state.settings.glassTransparency]);
  useEffect(() => () => {
    clearTimeout(appearanceTimer.current);
    if (pendingAppearance.current) act(api.settings(pendingAppearance.current));
  }, []);
  const adjustAppearance = patch => {
    const values = { glassTransparency: transparency, ...patch };
    setTransparency(values.glassTransparency);
    pendingAppearance.current = values;
    clearTimeout(appearanceTimer.current);
    // Preview immediately; coalesce persisted writes while the slider moves.
    applyAppearance({ ...state, settings: { ...state.settings, ...values } }, matchMedia('(prefers-color-scheme: dark)').matches, reducedTransparency);
    appearanceTimer.current = setTimeout(() => { pendingAppearance.current = null; act(api.settings(values)); }, 140);
  };
  const select = patch => {
    clearTimeout(appearanceTimer.current); pendingAppearance.current = null; setError('');
    act(api.settings({ ...patch, glassTransparency: transparency }));
  };
  const id = state.settings.themeId;
  const palette = state.vaultTheme.palette;
  const saved = state.themes.find(t => t.id === id);
  const mode = state.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : state.settings.theme;
  const following = id === 'vault' && Boolean(palette);
  const darkOnly = id === MONOKAI_SODA_THEME.id;
  const appearance = resolveAppearance(state, mode === 'dark');
  async function refresh() {
    setRefreshing(true);
    try { const result = await api.vaultTheme(true); if (result.ok) setStatus(result.value); else setError(result.error); }
    catch (e) { setError(e.message); }
    finally { setRefreshing(false); }
  }
  useEffect(() => {
    let active = true;
    const check = () => api.vaultTheme(true).then(result => { if (active && result.ok) setStatus(result.value); }).catch(() => {});
    const unsubscribe = api.onVaultStatus(value => { if (active) setStatus(value); });
    check();
    const timer = setInterval(check, 60_000); window.addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); unsubscribe(); };
  }, [api, state.settings.vaultAddress]);
  const save = async (event, update = false) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const result = await api.saveTheme(update ? saved.name : name, update ? saved.id : undefined);
      if (!result.ok) setError(result.error);
      else { setCopyOpen(false); act(Promise.resolve(result), update ? 'Vault copy updated' : 'Theme saved'); }
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  const connect = async event => {
    event.preventDefault(); setError('');
    const result = await api.settings({ vaultAddress: address.trim() });
    if (!result.ok) { setError(result.error); return; }
    await refresh();
  };
  return <section className="overlay themes" role="dialog" aria-modal="true" aria-label="Themes">
    <div className="overlay-top"><button className="icon-button" aria-label="Back to preferences" onClick={back}><ArrowLeft size={19} /></button><span>Themes</span><Palette size={16} /></div>
    <div className="themes-content">
      <h1>Make room<br />for your style.</h1>
      <p className="theme-intro">A familiar look for your little corner.</p>
      <div className="theme-section"><h2>Appearance</h2><div className="appearance-modes" role="group" aria-label="Appearance mode">
        {[[ 'light', Sun, 'Light' ], [ 'dark', Moon, 'Dark' ], [ 'system', Monitor, 'System' ]].map(([value, Icon, label]) => <button key={value} aria-label={`${label} appearance`} aria-pressed={!following && !darkOnly && state.settings.theme === value} disabled={following || darkOnly} onClick={() => select({ theme: value })}><Icon size={17} /><span>{label}</span></button>)}
      </div><p className="theme-caption">{following ? 'Live matching follows Obsidian’s light or dark mode.' : darkOnly ? 'Monokai Soda is a dark theme, so it stays dark.' : state.settings.theme === 'system' ? 'Changes with your Mac’s appearance.' : `Always use ${state.settings.theme} mode.`}</p>
      {appearance.fallback && <p className="theme-fallback">This copy has no {mode} palette yet. Default is used for {mode} mode. Switch Obsidian to {mode}, then update the copy below.</p>}
      </div>
      <div className="theme-section"><h2>Saved themes<span>{state.themes.length + 3}</span></h2><div className="theme-library">
        <button className={`theme-tile ${id === 'default' ? 'selected' : ''}`} aria-label="Use Default theme" aria-pressed={id === 'default'} onClick={() => select({ themeId: 'default' })}>
          <Preview tokens={DEFAULT_THEME[mode]} /><span className="theme-tile-label"><strong>Default</strong>{id === 'default' && <Check size={14} />}</span><small>Original cream & sage · Light + Dark</small>
        </button>
        <button className={`theme-tile ${id === GLASS_THEME.id ? 'selected' : ''}`} aria-label="Use Glass theme" aria-pressed={id === GLASS_THEME.id} onClick={() => select({ themeId: GLASS_THEME.id })}>
          <Preview tokens={GLASS_THEME[mode]} glass /><span className="theme-tile-label"><strong>Glass</strong>{id === GLASS_THEME.id && <Check size={14} />}</span><small>Frosted panes & colour accents · Light + Dark</small>
        </button>
        <button className={`theme-tile ${id === MONOKAI_SODA_THEME.id ? 'selected' : ''}`} aria-label="Use Monokai Soda theme" aria-pressed={id === MONOKAI_SODA_THEME.id} onClick={() => select({ themeId: MONOKAI_SODA_THEME.id })}>
          <Preview tokens={paletteTokens(MONOKAI_SODA_THEME.palette)} /><span className="theme-tile-label"><strong>Monokai Soda</strong>{id === MONOKAI_SODA_THEME.id && <Check size={14} />}</span><small>Charcoal & neon accents · Dark only</small>
        </button>
        {state.themes.map(theme => <button key={theme.id} className={`theme-tile ${id === theme.id ? 'selected' : ''}`} aria-label={`Use ${theme.name} theme`} aria-pressed={id === theme.id} onClick={() => select({ themeId: theme.id })}>
          <Preview tokens={theme.palettes[mode] ? paletteTokens(theme.palettes[mode]) : DEFAULT_THEME[mode]} /><span className="theme-tile-label"><strong>{theme.name}</strong>{id === theme.id && <Check size={14} />}</span><small>Vault copy · {theme.palettes.light && theme.palettes.dark ? 'Light + Dark' : theme.palettes.light ? 'Light captured' : 'Dark captured'}</small>
        </button>)}
      </div>
      {saved && <div className="saved-theme-actions"><button disabled={!palette || saving} onClick={e => save(e, true)}><RefreshCw size={12} />Update from vault</button><button aria-label={`Remove ${saved.name} theme`} onClick={() => act(api.deleteTheme(saved.id), 'Theme removed')}><Trash2 size={12} />Remove copy</button></div>}
      </div>
      {id === GLASS_THEME.id && <div className="theme-section glass-controls"><h2>Glass</h2>
        <label className="theme-slider-label" htmlFor="glass-transparency">Transparency<output>{Math.round(transparency * 100)}%</output></label>
        <input id="glass-transparency" aria-label="Glass transparency" type="range" min="0" max="1" step="0.01" value={transparency} disabled={reducedTransparency} onChange={e => adjustAppearance({ glassTransparency: Number(e.target.value) })} />
        <div className="theme-slider-ends"><span>Opaque</span><span>Glass</span></div>
        <p className="theme-caption">{reducedTransparency ? 'Your Mac’s Reduce Transparency setting keeps panes opaque.' : 'Blurred desktop, frosted cards, and the colours you know from CXTasks.'}</p>
      </div>}
      <div className="theme-section vault-section"><h2>Your Obsidian vault</h2>
        <button className={`vault-theme-choice ${id === 'vault' ? 'selected' : ''}`} aria-label="Match vault" aria-pressed={id === 'vault'} onClick={() => select({ themeId: 'vault' })}>
          <span className="vault-color" style={{ background: palette ? paletteTokens(palette).bg : 'var(--soft)', color: palette ? paletteTokens(palette).green : 'var(--green)' }}><Folder size={21} /></span><span><strong>Match vault</strong><small>Same appearance as Onyx & CXTasks</small></span>{id === 'vault' ? <Check size={16} /> : <ChevronRight size={16} />}
        </button>
        <p className="vault-status" role="status"><i className={status.connected ? 'connected' : ''} />{status.connected ? `Vault connected · ${palette?.mode || 'Current'} appearance` : palette ? 'Last vault appearance saved on this Mac.' : refreshing ? 'Looking for your vault…' : 'Waiting for your vault.'}</p>
        <p className="theme-caption">{status.connected ? 'Updates when your Obsidian theme changes. Save a copy to keep this look.' : 'Open Onyx and Obsidian with the Onyx plugin enabled. Margin keeps the last appearance if they close.'}</p>
        <div className="vault-actions"><button className="theme-secondary" disabled={refreshing} onClick={refresh}><RefreshCw size={13} className={refreshing ? 'spinning' : ''} />{refreshing ? 'Checking…' : 'Refresh'}</button><button className="theme-secondary" disabled={!palette} aria-label="Save vault theme copy" onClick={() => { setCopyOpen(!copyOpen); setError(''); }}><Copy size={13} />Save a copy</button></div>
        {copyOpen && <form className="theme-copy-form" onSubmit={save}><label>Theme name<input autoFocus aria-label="Theme name" value={name} maxLength={80} onChange={e => setName(e.target.value)} required /></label><p className="theme-caption">Captures the vault palettes seen so far. You can add its other mode with “Update from vault”.</p><button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save theme'}<Check size={13} /></button></form>}
        <details className="vault-address"><summary>Onyx connection</summary><form onSubmit={connect}><label>Local Onyx address<input aria-label="Onyx address" value={address} onChange={e => setAddress(e.target.value)} placeholder="http://127.0.0.1:8899" /></label><button className="theme-secondary" type="submit">Connect</button></form></details>
      </div>
      {error && <p className="editor-error" role="alert">{error}</p>}
    </div>
  </section>;
}
