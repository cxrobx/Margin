import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.platform === 'darwin') {
  const headers = [process.env.MARGIN_NODE_HEADERS, path.resolve(path.dirname(process.execPath), '../include/node'), '/usr/local/include/node', '/opt/homebrew/include/node'].filter(Boolean).find(p => existsSync(path.join(p, 'node_api.h')));
  if (!headers) {
    console.warn('Node-API headers unavailable; Margin will use macOS vibrancy for glass.');
  } else {
    const output = path.join(root, 'app/native'); mkdirSync(output, { recursive: true });
    const result = spawnSync('xcrun', ['clang++', '-std=c++17', '-shared', '-undefined', 'dynamic_lookup', '-fobjc-arc', '-framework', 'AppKit', '-DNAPI_VERSION=8', '-I' + headers, path.join(output, 'glass.mm'), '-o', path.join(output, 'glass.node')], { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      console.error('Could not compile the macOS glass bridge. See the compiler diagnostics above.');
      process.exit(1);
    }
    console.log('Built macOS glass bridge (Node-API).');
  }
}
