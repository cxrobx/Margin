import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defaultDataDir } from '../shared/store.mjs';
import { connectionInfo } from '../shared/connections.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const info = connectionInfo(process.execPath, path.join(root, 'server/index.mjs'), process.env.MARGIN_DATA_DIR || path.join(root, '.margin-data'));
console.log(JSON.stringify(info, null, 2));
