import React, { useEffect, useState } from 'react';
import { ArrowLeft, History, RotateCcw, Upload, ChevronRight } from 'lucide-react';

function Back({ close, title }) {
  return <div className="overlay-top"><button className="icon-button" aria-label="Back to notes" onClick={close}><ArrowLeft size={19} /></button><span>{title}</span><span /></div>;
}
export function NoteHistory({ note, api, act, close, Markdown }) {
  const [entries, setEntries] = useState(null); const [selected, setSelected] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { let active = true; api.history(note.id).then(result => { if (!active) return; if (result.ok) setEntries(result.value); else setError(result.error); }); return () => { active = false; }; }, [note.id]);
  const entry = entries?.[selected];
  const restore = async () => {
    setBusy(true);
    const result = await api.restoreVersion(note.id, entry.revision, entries[0].revision);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    await act(Promise.resolve(result), 'Earlier version restored'); close();
  };
  return <section className="overlay notebook-tools" role="dialog" aria-modal="true" aria-label="Note history"><Back close={close} title="Note history" /><div className="tools-content"><h1>{note.title}</h1><p className="subtle">Preview an earlier version before restoring it. Your current writing stays in history.</p>{error && <p role="alert" className="tools-error">{error}</p>}{entries ? <><label className="version-select">Saved version<select aria-label="Saved version" value={selected} onChange={event => setSelected(Number(event.target.value))}>{entries.map((item, index) => <option key={item.revision} value={index}>{index === 0 ? 'Current · ' : ''}{new Date(item.savedAt).toLocaleString()} · {item.source} · v{item.revision}</option>)}</select></label><article className={`history-preview color-${entry.note.color}`}><h2>{entry.note.title}</h2><div className="markdown"><Markdown body={entry.note.body} act={act} /></div>{entry.note.attachments.length > 0 && <p className="subtle">Attachments: {entry.note.attachments.map(item => item.name).join(', ')}</p>}</article><button className="tool-primary" disabled={busy || selected === 0} onClick={restore}><RotateCcw size={15} />{busy ? 'Restoring…' : 'Restore this version'}</button>{entries.length === 1 && <p className="subtle">Earlier versions appear as you edit this note.</p>}</> : !error && <p>Loading saved versions…</p>}</div></section>;
}
export function BackupTools({ api, act, close, initialPlan, demo, Markdown }) {
  const [backups, setBackups] = useState([]); const [plan, setPlan] = useState(initialPlan || null); const [mode, setMode] = useState('merge'); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api.backups().then(result => result.ok ? setBackups(result.value) : setError(result.error)); }, []);
  const prepare = async name => {
    setBusy(true); setError('');
    const result = await (name ? api.previewBackup(name) : api.prepareImport());
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    if (result.value) { setPlan(result.value); setMode(name ? 'replace' : 'merge'); setConfirm(false); }
  };
  const apply = async () => {
    setBusy(true); setError('');
    const result = await api.applyImport(plan.token, mode);
    setBusy(false); setConfirm(false);
    if (!result.ok) { setError(result.error); return; }
    await act(Promise.resolve(result), mode === 'merge' ? 'Backup notes imported' : 'Notebook restored'); close();
  };
  return <section className="overlay notebook-tools" role="dialog" aria-modal="true" aria-label="Backups and import"><Back close={close} title="Backups & import" /><div className="tools-content"><h1>Keep your thoughts safe.</h1><p className="subtle">Import an exported backup, or recover one of Margin’s last 40 automatic snapshots.</p>{error && <p role="alert" className="tools-error">{error}</p>}{!plan ? <><button className="tool-primary" disabled={busy} onClick={() => prepare()}><Upload size={15} />Choose backup to import</button><h2>Automatic backups</h2>{backups.length ? backups.map(backup => <button className="backup-row" key={backup.name} disabled={busy || backup.demo} onClick={() => prepare(backup.name)}><History size={16} /><span><strong>{new Date(backup.at).toLocaleString()}</strong><small>{backup.count} notes{backup.demo ? ' · Demo snapshot' : ''}</small></span><ChevronRight size={15} /></button>) : <p className="subtle">Automatic snapshots appear after your first change.</p>}</> : <><button className="text-button" disabled={busy} onClick={() => { setPlan(null); setConfirm(false); }}>← Choose a different backup</button><h2>{plan.name}</h2><p>{plan.count} notes{plan.trash ? `, including ${plan.trash} in Trash` : ''} · {plan.folders.length} folders</p><div className="backup-titles">{plan.titles.map((title, index) => <div key={index}>{title}</div>)}{plan.count > plan.titles.length && <div>…and {plan.count - plan.titles.length} more</div>}</div><label className="version-select">How to import<select aria-label="Backup import mode" disabled={busy} value={mode} onChange={event => { setMode(event.target.value); setConfirm(false); }}><option value="merge">Add notes to my notebook</option><option value="replace" disabled={demo}>Restore the entire notebook</option></select></label><p className="subtle">{mode === 'merge' ? 'Imported notes are added as separate copies. Folders with the same name are combined.' : 'This replaces your notes, folders, and Trash. Your appearance and preferences stay. Margin saves your current notebook as a backup first.'}</p>{confirm && <div className="restore-confirm" role="alertdialog" aria-label="Restore notebook confirmation"><strong>Restore this entire notebook?</strong><p>Your current notes will be replaced with the preview above.</p><button className="tool-primary" disabled={busy} onClick={apply}>{busy ? 'Restoring…' : 'Confirm restore notebook'}</button><button className="text-button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div>}{!confirm && <button className="tool-primary" disabled={busy} onClick={() => mode === 'replace' ? setConfirm(true) : apply()}><RotateCcw size={15} />{busy ? 'Importing…' : mode === 'replace' ? 'Restore notebook…' : 'Import these notes'}</button>}</>}</div></section>;
}
