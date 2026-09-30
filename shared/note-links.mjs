const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function noteLink(id) {
  if (!uuid.test(id)) throw new Error('Invalid note link.');
  return `margin://note/${id}`;
}
export function noteIdFromLink(value) {
  const url = new URL(value);
  if (url.protocol !== 'margin:' || url.hostname !== 'note' || url.search || url.hash || !uuid.test(url.pathname.slice(1))) throw new Error('Invalid Margin note link.');
  return url.pathname.slice(1);
}
