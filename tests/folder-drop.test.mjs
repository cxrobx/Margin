import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFolderDrop } from '../renderer/folder-drop.mjs';

const folders = [
  { id: 'inbox', name: 'Inbox', parentId: null },
  { id: 'work', name: 'Work', parentId: null },
  { id: 'personal', name: 'Personal', parentId: null },
  { id: 'a', name: 'Client A', parentId: 'work' },
  { id: 'drafts', name: 'Drafts', parentId: 'a' },
  { id: 'b', name: 'Client B', parentId: 'work' }
];

test('folder centers nest, ancestor centers lift, and All promotes a subfolder to the root', () => {
  assert.deepEqual(resolveFolderDrop(folders, 'b', 'a', 'inside'), { action: 'move-folder', parentId: 'a', targetId: null, placement: 'folder' });
  assert.equal(resolveFolderDrop(folders, 'drafts', 'work', 'inside').parentId, 'work');
  assert.equal(resolveFolderDrop(folders, 'a', 'all', 'inside').parentId, null);
  assert.equal(resolveFolderDrop(folders, 'a', 'personal', 'inside').parentId, 'personal', 'A parent carries its subtree to another parent');
});

test('tab edges reorder siblings and move a subfolder beside a tab in a higher-level row', () => {
  assert.deepEqual(resolveFolderDrop(folders, 'b', 'a', 'before'), { action: 'reorder', targetId: 'a', placement: 'before' });
  assert.deepEqual(resolveFolderDrop(folders, 'drafts', 'b', 'after'), { action: 'move-folder', parentId: 'work', targetId: 'b', placement: 'after' });
  assert.deepEqual(resolveFolderDrop(folders, 'a', 'personal', 'before'), { action: 'move-folder', parentId: null, targetId: 'personal', placement: 'before' });
  assert.equal(resolveFolderDrop(folders, 'all', 'work', 'after').action, 'reorder');
  assert.equal(resolveFolderDrop(folders, 'inbox', 'personal', 'before').action, 'reorder');
});

test('folder drags reject cycles, excessive subtree depth, special tabs, and no-op moves', () => {
  for (const [source, target, placement] of [
    ['a', 'a', 'inside'], ['a', 'drafts', 'inside'], ['a', 'drafts', 'before'],
    ['a', 'b', 'inside'], ['b', 'drafts', 'inside'], ['inbox', 'work', 'inside'],
    ['all', 'work', 'inside'], ['all', 'b', 'before'], ['a', 'work', 'inside'],
    ['missing', 'work', 'inside'], ['a', 'missing', 'inside'], ['b', 'a', 'invalid']
  ]) assert.equal(resolveFolderDrop(folders, source, target, placement), null, `${source} → ${target}: ${placement}`);
  const duplicate = [...folders, { id: 'other', name: 'CLIENT B', parentId: 'personal' }];
  assert.equal(resolveFolderDrop(duplicate, 'b', 'personal', 'inside'), null, 'Names remain unique within the destination');
});
