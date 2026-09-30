import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseAppLink } from '../shared/app-links.mjs';

const exec = promisify(execFile);
const applications = {
  onyx: { name: 'Onyx', bundle: 'com.cx.onyx' },
  obsidian: { name: 'Obsidian', bundle: 'md.obsidian' },
  cxtasks: { name: 'CXTasks', bundle: 'com.cxtasks.app' }
};
let cached, checkedAt = 0;
export async function installedLinkApps({ refresh = false } = {}) {
  if (!refresh && cached && Date.now() - checkedAt < 30_000) return cached;
  if (process.platform !== 'darwin') return {};
  const entries = await Promise.all(Object.entries(applications).map(async ([id, info]) => {
    let candidates = [`/Applications/${info.name}.app`, path.join(os.homedir(), 'Applications', info.name + '.app')];
    try { const { stdout } = await exec('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == "${info.bundle}"`], { timeout: 3000 }); candidates.push(...stdout.trim().split('\n')); } catch {}
    for (const candidate of new Set(candidates)) {
      if (!path.isAbsolute(candidate) || !candidate.endsWith('.app')) continue;
      try {
        const { stdout } = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(candidate, 'Contents', 'Info.plist')], { timeout: 2000 });
        if (stdout.trim() === info.bundle) return [id, candidate];
      } catch {}
    }
    return [id, null];
  }));
  cached = Object.fromEntries(entries.filter(([, value]) => value)); checkedAt = Date.now(); return cached;
}
export function createLinkOpener({ getApps = installedLinkApps, launch = (application, value) => exec('/usr/bin/open', ['-a', application, value], { timeout: 10_000 }), stat = fs.stat, home = os.homedir(), openExternal }) {
  const localPath = link => path.normalize(link.path.startsWith('~/') ? path.join(home, link.path.slice(2)) : link.path);
  async function describe(value) {
    const link = parseAppLink(value);
    const apps = await getApps();
    if (link.kind === 'document') return { kind: link.kind, path: localPath(link), choices: ['onyx', 'obsidian'].filter(id => apps[id]).map(id => ({ id, name: applications[id].name })), defaultApp: apps.onyx ? 'onyx' : apps.obsidian ? 'obsidian' : null };
    return { kind: link.kind, choices: [] };
  }
  async function open(value, preferred) {
    const link = parseAppLink(value);
    if (link.kind === 'web') return openExternal(link.href);
    if (link.kind === 'note') throw new Error('Margin note links are handled by the notebook.');
    const apps = await getApps();
    if (link.kind === 'task' || link.kind === 'obsidian') {
      const id = link.kind === 'task' ? 'cxtasks' : 'obsidian';
      if (!apps[id]) throw new Error(`Install ${applications[id].name} to open this link.`);
      return launch(apps[id], link.href);
    }
    if (preferred && !['onyx', 'obsidian'].includes(preferred)) throw new Error('Invalid document app.');
    const id = preferred || (apps.onyx ? 'onyx' : apps.obsidian ? 'obsidian' : null);
    if (!id) throw new Error('Install Onyx or Obsidian to open this document.');
    if (!apps[id]) throw new Error(`${applications[id].name} is not installed.`);
    const file = localPath(link);
    let info; try { info = await stat(file); } catch { throw new Error('This document has moved or is no longer available.'); }
    if (!info.isFile()) throw new Error('This link must point to a document file.');
    const destination = id === 'obsidian' ? `obsidian://open?path=${encodeURIComponent(file)}` : file;
    return launch(apps[id], destination);
  }
  return { describe, open };
}
