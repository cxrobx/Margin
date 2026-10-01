export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const attachmentPattern = /margin:\/\/attachment\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/g;

export const attachmentUrl = id => `margin://attachment/${id}`;
export function imageAttachmentId(src) {
  return typeof src === 'string' ? /^margin:\/\/attachment\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.exec(src)?.[1] : undefined;
}
export function separateAttachments(note) {
  const inline = new Set(Array.from(note.body.matchAll(attachmentPattern), match => match[1]));
  return (note.attachments || []).filter(attachment => !attachment.inline && !inline.has(attachment.id));
}
export function replaceAttachmentUrls(body, replacements) {
  return body.replace(attachmentPattern, (url, id) => replacements.get(id) || url);
}
