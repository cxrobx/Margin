import { useEffect, useState } from 'react';

const requests = new Map(), resolved = new Map(), listeners = new Set();
// Titles and task status change outside Margin, so look again whenever the
// panel regains focus. Chips keep their last answer until the new one lands.
window.addEventListener('focus', () => { requests.clear(); listeners.forEach(listener => listener()); });
function load(href) {
  if (!requests.has(href)) requests.set(href, window.margin.linkPreview(href).then(result => result.ok ? result.value : null).catch(() => null)
    .then(value => { resolved.set(href, value); return value; }));
  return requests.get(href);
}
export function useLinkPreview(href) {
  const [preview, setPreview] = useState(() => resolved.get(href) ?? null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => { const listener = () => setEpoch(value => value + 1); listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  useEffect(() => { let live = true; load(href).then(value => { if (live) setPreview(value); }); return () => { live = false; }; }, [href, epoch]);
  return preview;
}
