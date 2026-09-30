const editableFields = ['title', 'body', 'color', 'folderId', 'kind', 'pinned', 'icon', 'iconColor', 'bodyHeight'];

// Keep one write in flight and adopt its revision before saving newer typing.
// A local recovery draft stays current even while the notebook write is pending.
export class NoteAutosave {
  constructor(initial, api, { changed, retain, clear, delay = 650 }) {
    this.draft = initial;
    this.saved = initial.__recovered ? null : initial;
    this.wrapCode = Boolean(initial.__wrapCode) || !initial.id;
    this.api = api;
    this.changed = changed;
    this.retain = retain;
    this.clear = clear;
    this.delay = delay;
    this.pending = null;
    this.timer = null;
    this.paused = false;
    this.error = '';
    this.conflict = false;
  }
  get dirty() { return !this.saved || editableFields.some(key => this.draft[key] !== this.saved[key]); }
  get canSave() { return Boolean(this.draft.id || this.draft.title.trim() || this.draft.body.trim()); }
  get status() {
    if (this.error) return 'Couldn’t save';
    if (this.pending || this.paused || (this.dirty && this.canSave)) return 'Saving…';
    return this.draft.id ? 'Saved' : '';
  }
  notify() { this.changed?.(); }
  remember() {
    if (this.dirty) this.retain({ ...this.draft, __wrapCode: this.wrapCode });
    else this.clear();
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.dirty && this.canSave && !this.error && !this.paused) this.timer = setTimeout(() => this.save(), this.delay);
  }
  update(patch) {
    this.draft = { ...this.draft, ...patch };
    if (!this.conflict) this.error = '';
    this.remember(); this.notify(); this.schedule();
  }
  fail(result) {
    this.error = result.error || 'Your note couldn’t be saved. Your draft is kept on this Mac.';
    this.conflict = Boolean(result.conflict);
    this.remember(); this.notify();
    return false;
  }
  save() {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    if (this.conflict || this.paused) return Promise.resolve(false);
    this.error = '';
    // Defer the work so pending is assigned before the first notification.
    this.pending = Promise.resolve().then(async () => {
      while (this.dirty && this.canSave) {
        const snapshot = this.draft;
        const fields = Object.fromEntries(editableFields.filter(key => snapshot[key] !== undefined).map(key => [key, snapshot[key]]));
        fields.title = snapshot.title.trim() || snapshot.body.trim().split('\n')[0].replace(/^[-#*\s]+/, '').slice(0, 80) || 'Untitled note';
        fields.source = 'You';
        if (this.wrapCode && fields.kind === 'code' && !fields.body.startsWith('```')) fields.body = '```\n' + fields.body + '\n```';
        let result;
        try {
          result = await (snapshot.id ? this.api.update(snapshot.id, { ...fields, expectedRevision: snapshot.revision }) : this.api.create(fields));
        } catch (error) { return this.fail({ error: error.message }); }
        if (!result.ok) return this.fail(result);
        const { id, revision, attachments, updatedAt } = result.value;
        // Preserve edits made during the write and the editor's undo history.
        this.saved = { ...snapshot, id, revision };
        this.draft = { ...this.draft, id, revision, attachments, updatedAt };
        delete this.draft.__recovered;
        this.remember(); this.notify();
      }
      return true;
    }).finally(() => { this.pending = null; this.notify(); });
    this.notify();
    return this.pending;
  }
  reset(note) {
    clearTimeout(this.timer);
    this.draft = note; this.saved = note; this.wrapCode = !note.id;
    this.error = ''; this.conflict = false;
    this.clear(); this.notify();
  }
  saveAsNew() {
    this.draft = { ...this.draft, id: undefined, revision: undefined, attachments: [] };
    this.saved = null; this.error = ''; this.conflict = false;
    this.remember(); this.notify();
    return this.save();
  }
  async attach() {
    if (!await this.save() || !this.draft.id) return;
    this.paused = true; this.notify();
    const snapshot = this.draft;
    try {
      const result = await this.api.attach(snapshot.id);
      if (!result.ok) { this.fail(result); return; }
      if (result.value) {
        const note = result.value;
        if (note.revision !== snapshot.revision + note.attachments.length - (snapshot.attachments?.length || 0)) {
          this.fail({ conflict: true, error: 'This note changed while you added an attachment. Your draft has been preserved. Reload the latest note or save your draft as a new note.' });
          return;
        }
        this.draft = { ...this.draft, attachments: note.attachments, revision: note.revision };
        this.saved = { ...this.saved, attachments: note.attachments, revision: note.revision };
        this.remember();
      }
    } catch (error) { this.fail({ error: error.message }); }
    finally { this.paused = false; this.notify(); this.schedule(); }
  }
  dispose() {
    this.changed = null;
    // Flush on navigation; retaining each change also covers sudden shutdowns.
    if (this.dirty && !this.error) this.save();
    clearTimeout(this.timer);
  }
}
