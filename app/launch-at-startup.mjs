// macOS owns this preference, so changes in System Settings stay authoritative.
// Never register the development Electron binary or a smoke-test app at login.
export function createLaunchAtStartup({ app, platform = process.platform, env = process.env }) {
  const supported = platform === 'darwin' && app.isPackaged && !env.MARGIN_SMOKE_TEST;
  function getStatus() {
    if (!supported) return { supported: false, enabled: false, requiresApproval: false };
    const settings = app.getLoginItemSettings();
    const requiresApproval = settings.status === 'requires-approval';
    return { supported: true, enabled: Boolean(settings.openAtLogin || requiresApproval), requiresApproval };
  }
  function setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether Margin should launch at startup.');
    if (!supported) throw new Error('Launch at startup is available in the installed Mac app.');
    app.setLoginItemSettings({ openAtLogin: enabled });
    const status = getStatus();
    if (status.enabled !== enabled) throw new Error('Could not change launch at startup. Try again from Applications or check System Settings → General → Login Items.');
    return status;
  }
  return { getStatus, setEnabled };
}
