import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const mac = pkg.build.mac;
const targets = [].concat(mac.target).map(t => typeof t === 'string' ? { target: t } : t);

test('the build publishes to GitHub and targets dmg and zip for arm64', () => {
  assert.deepEqual(pkg.build.publish, { provider: 'github', owner: 'cxrobx', repo: 'Margin' });
  for (const name of ['dmg', 'zip']) {
    const entry = targets.find(t => t.target === name);
    assert.ok(entry, `${name} target is missing; Squirrel.Mac needs both`);
    assert.deepEqual([].concat(entry.arch), ['arm64']);
  }
  assert.equal(targets.some(t => t.target === 'dir'), false, 'a dir-only build cannot auto-update');
  assert.equal(pkg.build.appId, 'local.margin.notes', 'the bundle id must not change or updates and settings break');
  assert.equal(pkg.build.asar, false);
});

test('artifact names match the published pattern so latest-mac.yml names real files', () => {
  assert.equal(mac.artifactName, 'Margin-${version}-macOS-${arch}.${ext}');
  assert.equal(pkg.build.dmg.artifactName, 'Margin-${version}-macOS-${arch}.${ext}');
  const name = ext => mac.artifactName.replace('${version}', pkg.version).replace('${arch}', 'arm64').replace('${ext}', ext);
  assert.equal(name('zip'), `Margin-${pkg.version}-macOS-arm64.zip`);
  assert.equal(name('dmg'), `Margin-${pkg.version}-macOS-arm64.dmg`);
  assert.doesNotMatch(mac.artifactName, /\s/, 'spaces become dots on GitHub and break the feed');
});

test('signing uses the hardened runtime with committed, minimal entitlements', () => {
  assert.equal(mac.hardenedRuntime, true);
  for (const key of ['entitlements', 'entitlementsInherit']) {
    assert.ok(mac[key], `${key} must be set explicitly`);
    const file = path.join(root, mac[key]);
    assert.ok(existsSync(file), `${mac[key]} must be committed`);
    const plist = readFileSync(file, 'utf8');
    const keys = [...plist.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map(match => match[1]).sort();
    assert.deepEqual(keys, ['com.apple.security.cs.allow-jit'], 'only what Electron needs at run time; widen it deliberately, not by default');
    assert.doesNotMatch(plist, /<false\/>/);
  }
  assert.equal(mac.notarize, undefined, 'notarization is on by default and driven by APPLE_KEYCHAIN_PROFILE, never by a committed switch');
});

test('electron-updater ships inside the app and the version files agree', () => {
  assert.ok(pkg.dependencies['electron-updater'], 'electron-updater must be a runtime dependency, or electron-builder leaves it out of the app');
  assert.equal(pkg.devDependencies?.['electron-updater'], undefined);
  assert.ok(pkg.build.files.includes('app/**'), 'app/updater.mjs ships with app/**');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.ok(lock.packages['node_modules/electron-updater'], 'the lockfile must pin electron-updater');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'a release version is a stable x.y.z');
});

test('the feed override cannot redirect a release build: nothing in the config or app sets it', () => {
  assert.equal(pkg.build.publish.provider, 'github');
  for (const file of ['app/main.mjs', 'app/updater.mjs']) {
    const text = read(file);
    assert.doesNotMatch(text, /setFeedURL\(\s*['"`]https?:/, `${file} must not hardcode a feed`);
  }
  assert.doesNotMatch(read('package.json'), /MARGIN_UPDATE_FEED/);
});

test('release scripts are executable and ship as npm scripts', () => {
  for (const file of ['scripts/release.sh', 'scripts/verify-update-feed.sh']) assert.ok(statSync(path.join(root, file)).mode & 0o100, `${file} must be executable`);
  assert.equal(pkg.scripts.release, 'bash scripts/release.sh');
  assert.equal(pkg.scripts['verify:update-feed'], 'bash scripts/verify-update-feed.sh');
  assert.match(pkg.scripts.package, /--publish never/);
});

// The release script must refuse before it builds anything, so these run for real.
function sandbox(t, { version = pkg.version } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'margin-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'scripts'));
  for (const file of ['scripts/release.sh', 'scripts/verify-update-feed.sh']) cpSync(path.join(root, file), path.join(dir, file));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'margin-notes', version }));
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test'); git('add', '-A'); git('commit', '-q', '-m', 'init');
  const release = (...args) => spawnSync('bash', ['scripts/release.sh', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH } });
  return { dir, git, release };
}

test('release.sh refuses a dirty tree', t => {
  const { dir, release } = sandbox(t);
  writeFileSync(path.join(dir, 'stray.txt'), 'uncommitted');
  const result = release(pkg.version);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git tree is dirty/);
});

test('release.sh refuses --publish from a dirty tree even with --allow-dirty', t => {
  const { dir, release } = sandbox(t);
  writeFileSync(path.join(dir, 'stray.txt'), 'uncommitted');
  const result = release(pkg.version, '--publish', '--allow-dirty');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git tree is dirty/);
  assert.doesNotMatch(result.stdout, /Building|Packaging/);
});

test('release.sh refuses a tag that already exists', t => {
  const { git, release } = sandbox(t);
  git('tag', `v${pkg.version}`);
  const result = release(pkg.version);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`tag v${pkg.version.replaceAll('.', '\\.')} already exists`));
});

test('release.sh refuses a version that differs from package.json', t => {
  const { release } = sandbox(t);
  const result = release('9.9.9');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package\.json is at .* not 9\.9\.9/);
});

test('release.sh refuses prerelease and malformed versions, and a missing version', t => {
  const { release } = sandbox(t);
  for (const bad of ['0.1.2-test', 'v0.1.2', '1.0', 'latest']) {
    const result = release(bad);
    assert.notEqual(result.status, 0, bad);
    assert.match(result.stderr, /stable x\.y\.z/, bad);
  }
  const none = release();
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /usage/);
});

test('release.sh refuses a package-lock.json that was not bumped', t => {
  const { dir, git, release } = sandbox(t);
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ version: '0.0.1', packages: { '': { version: '0.0.1' } } }));
  git('commit', '-q', '-am', 'stale lock');
  const result = release(pkg.version);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package-lock\.json versions are/);
});

// verify-update-feed.sh checks integrity before it trusts a zip.
function feed(t, { yml, files = {} }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'margin-feed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (yml !== undefined) writeFileSync(path.join(dir, 'latest-mac.yml'), yml);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}
const verify = dir => spawnSync('bash', [path.join(root, 'scripts/verify-update-feed.sh'), dir], { encoding: 'utf8' });
const sha512 = body => execFileSync('openssl', ['dgst', '-sha512', '-binary'], { input: body }).toString('base64');
const hasYaml = existsSync(path.join(root, 'node_modules/js-yaml'));

test('verify-update-feed.sh fails when latest-mac.yml is missing', { skip: !hasYaml }, t => {
  const result = verify(feed(t, { files: {} }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /latest-mac\.yml could not be fetched/);
});

test('verify-update-feed.sh rejects a zip whose sha512 does not match the yml', { skip: !hasYaml }, t => {
  const body = 'not really a zip';
  const name = 'Margin-0.1.1-macOS-arm64.zip';
  const yml = `version: 0.1.1\nfiles:\n  - url: ${name}\n    sha512: ${sha512('different bytes')}\n    size: ${body.length}\npath: ${name}\nsha512: ${sha512('different bytes')}\n`;
  const result = verify(feed(t, { yml, files: { [name]: body } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /zip size \d+ bytes matches/);
  assert.match(result.stdout, /zip sha512 does not match the yml/);
  assert.doesNotMatch(result.stdout, /zip contains|codesign|TeamIdentifier/, 'an unverified zip is never inspected');
});

test('verify-update-feed.sh rejects a wrong size', { skip: !hasYaml }, t => {
  const body = 'not really a zip';
  const name = 'Margin-0.1.1-macOS-arm64.zip';
  const yml = `version: 0.1.1\nfiles:\n  - url: ${name}\n    sha512: ${sha512(body)}\n    size: ${body.length + 1}\npath: ${name}\nsha512: ${sha512(body)}\n`;
  const result = verify(feed(t, { yml, files: { [name]: body } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /zip size is \d+ but the yml says/);
});

test('verify-update-feed.sh flags a zip name that disagrees with the yml version and a listed file that is absent', { skip: !hasYaml }, t => {
  const body = 'not really a zip';
  const name = 'Margin-0.1.0-macOS-arm64.zip';
  const yml = `version: 0.1.1\nfiles:\n  - url: ${name}\n    sha512: ${sha512(body)}\n    size: ${body.length}\n  - url: Margin-0.1.1-macOS-arm64.dmg\n    sha512: ${sha512('dmg')}\n    size: 3\npath: ${name}\nsha512: ${sha512(body)}\n`;
  const result = verify(feed(t, { yml, files: { [name]: body } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /does not follow Margin-0\.1\.1-macOS-arm64\.zip/);
  assert.match(result.stdout, /Margin-0\.1\.1-macOS-arm64\.dmg is listed in the yml but is not in the folder/);
});

test('verify-update-feed.sh refuses unsafe file names in the yml', { skip: !hasYaml }, t => {
  const yml = `version: 0.1.1\nfiles:\n  - url: ../../etc/passwd\n    sha512: ${sha512('x')}\n    size: 1\npath: ../../etc/passwd\nsha512: ${sha512('x')}\n`;
  const result = verify(feed(t, { yml }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unsafe or missing url/);
});

test('verify-update-feed.sh refuses a yml with no zip, because macOS updates install from the zip', { skip: !hasYaml }, t => {
  const yml = `version: 0.1.1\nfiles:\n  - url: Margin-0.1.1-macOS-arm64.dmg\n    sha512: ${sha512('x')}\n    size: 1\npath: Margin-0.1.1-macOS-arm64.dmg\nsha512: ${sha512('x')}\n`;
  const result = verify(feed(t, { yml }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /lists no \.zip/);
});
