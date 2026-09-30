export const MIN_NOTE_BODY_HEIGHT = 56;
export const MAX_NOTE_BODY_HEIGHT = 1600;
export const constrainNoteBodyHeight = height => Math.min(MAX_NOTE_BODY_HEIGHT, Math.max(MIN_NOTE_BODY_HEIGHT, Math.round(height)));
