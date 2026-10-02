import React, { useEffect, useRef, useState } from 'react';

export default function LaunchAtStartup({ api }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changing = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (changing.current) return;
      const id = ++request.current;
      try {
        const result = await api.launchAtStartup();
        if (!active || changing.current || id !== request.current) return;
        if (!result.ok) throw new Error(result.error);
        setStatus(result.value); setError('');
      } catch (error) { if (active && !changing.current && id === request.current) setError(error.message); }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [api]);
  const change = async enabled => {
    if (changing.current) return;
    request.current++;
    changing.current = true; setBusy(true); setError('');
    try {
      const result = await api.setLaunchAtStartup(enabled);
      if (!result.ok) throw new Error(result.error);
      setStatus(result.value);
    } catch (error) {
      setError(error.message);
      // A native change can succeed even if its follow-up status read fails.
      try { const result = await api.launchAtStartup(); if (result.ok) setStatus(result.value); } catch {}
    } finally { changing.current = false; setBusy(false); }
  };
  const caption = !status ? error ? 'Startup settings are unavailable' : 'Checking startup settings…' : !status.supported ? 'Available in the installed Mac app' : status.requiresApproval ? 'Allow Margin in System Settings → General → Login Items' : 'Start Margin when you log in to your Mac';
  return <>
    <label className="pref-row"><div><strong>Launch at startup</strong><small id="startup-caption">{caption}</small></div><input aria-label="Launch at startup" aria-describedby="startup-caption" type="checkbox" checked={status?.enabled ?? false} disabled={!status?.supported || busy} onChange={event => change(event.target.checked)} /></label>
    {error && <p className="pref-caption error" role="alert">{error}</p>}
  </>;
}
