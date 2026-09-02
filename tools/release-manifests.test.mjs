// What gets published to WinGet, Chocolatey and Homebrew.
//
// These manifests carry a URL and a checksum to machines that will install from
// them without asking anyone. A wrong version, a missing hash or a prerelease
// escaping into a stable channel is not the kind of mistake that surfaces
// quickly, so the rules are checked here rather than on someone's laptop.
import assert from 'node:assert/strict';
import {
  versionFromTag, shouldPublish, pickAsset, sha256,
  wingetManifests, chocolateyPackage, homebrewCask, IDENTIFIER,
} from './release-manifests.mjs';

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

// --- versions ---------------------------------------------------------------
check('a tag becomes a package version without its v', () => {
  assert.deepEqual(versionFromTag('v0.4.5'), { version: '0.4.5', base: '0.4.5', prerelease: false });
});

check('a prerelease tag is recognised as one', () => {
  const parsed = versionFromTag('v0.4.5-beta.1');
  assert.equal(parsed.version, '0.4.5-beta.1');
  assert.equal(parsed.base, '0.4.5');
  assert.equal(parsed.prerelease, true);
});

check('a tag without a v still parses', () => {
  assert.equal(versionFromTag('0.4.5').version, '0.4.5');
});

// --- what reaches a package manager ------------------------------------------
check('stable releases publish', () => {
  assert.equal(shouldPublish('v0.4.5'), true);
});

check('prereleases do NOT publish', () => {
  // Package managers are where people who did not opt into anything install
  // from. Everything before 0.4.5 was a prerelease, so getting this backwards
  // would have shipped a beta to everyone.
  assert.equal(shouldPublish('v0.4.5-beta.1'), false);
  assert.equal(shouldPublish('v1.0.0-rc.2'), false);
});

// --- asset selection ---------------------------------------------------------
const ASSETS = [
  { name: 'Neuron-0.4.5-win-x64.exe' },
  { name: 'Neuron-0.4.5-win-x64-portable.exe' },
  { name: 'Neuron-0.4.5-win-x64.exe.blockmap' },
  { name: 'Neuron-0.4.5-mac-arm64.dmg' },
  { name: 'Neuron-0.4.5-mac-x64.dmg' },
  { name: 'Neuron-0.4.5-mac-arm64.zip' },
  { name: 'Neuron-0.4.5-linux-amd64.deb' },
  { name: 'latest.yml' },
];

check('the installer is chosen, not the portable build', () => {
  // A package manager installs and uninstalls; the portable exe cannot be
  // uninstalled, and the blockmap is not an installer at all.
  assert.equal(pickAsset(ASSETS, 'win-installer').name, 'Neuron-0.4.5-win-x64.exe');
});

check('each macOS architecture is picked separately', () => {
  assert.equal(pickAsset(ASSETS, 'mac-arm').name, 'Neuron-0.4.5-mac-arm64.dmg');
  assert.equal(pickAsset(ASSETS, 'mac-intel').name, 'Neuron-0.4.5-mac-x64.dmg');
});

check('the dmg is chosen over the zip', () => {
  assert.ok(pickAsset(ASSETS, 'mac-arm').name.endsWith('.dmg'));
});

check('a missing asset is null rather than a wrong guess', () => {
  assert.equal(pickAsset([{ name: 'latest.yml' }], 'win-installer'), null);
});

// --- WinGet -------------------------------------------------------------------
const HASH = sha256(Buffer.from('neuron'));
const winget = wingetManifests({ version: '0.4.5', url: 'https://example.test/Neuron.exe', hash: HASH });

check('WinGet gets the three manifests it requires', () => {
  assert.deepEqual(Object.keys(winget).sort(), [
    `${IDENTIFIER}.installer.yaml`,
    `${IDENTIFIER}.locale.en-US.yaml`,
    `${IDENTIFIER}.yaml`,
  ].sort());
});

check('every WinGet manifest carries the same version', () => {
  for (const [name, body] of Object.entries(winget)) {
    assert.match(body, /PackageVersion: 0\.4\.5/, `${name} must state the version`);
    assert.match(body, new RegExp(`PackageIdentifier: ${IDENTIFIER.replace('.', '\\.')}`), name);
  }
});

check('the WinGet hash is upper-case, as the schema requires', () => {
  const installer = winget[`${IDENTIFIER}.installer.yaml`];
  assert.match(installer, new RegExp(`InstallerSha256: ${HASH.toUpperCase()}`));
  assert.ok(!installer.includes(HASH), 'the lower-case form must not appear');
});

check('WinGet describes the installer that actually ships', () => {
  const installer = winget[`${IDENTIFIER}.installer.yaml`];
  assert.match(installer, /InstallerType: nullsoft/);
  assert.match(installer, /^Scope: user$/m);
});

// --- Chocolatey ----------------------------------------------------------------
const choco = chocolateyPackage({ version: '0.4.5', url: 'https://example.test/Neuron.exe', hash: HASH });

check('Chocolatey gets a nuspec and both scripts', () => {
  assert.deepEqual(Object.keys(choco).sort(),
    ['neuron.nuspec', 'tools/chocolateyinstall.ps1', 'tools/chocolateyuninstall.ps1']);
});

check('the Chocolatey install verifies a sha256', () => {
  const install = choco['tools/chocolateyinstall.ps1'];
  assert.match(install, new RegExp(`-Checksum64 '${HASH}'`));
  assert.match(install, /-ChecksumType64 'sha256'/);
});

check('the nuspec version has no v and no leading zero problems', () => {
  assert.match(choco['neuron.nuspec'], /<version>0\.4\.5<\/version>/);
});

check('the Chocolatey install is silent, so it can be automated', () => {
  assert.match(choco['tools/chocolateyinstall.ps1'], /-SilentArgs '\/S'/);
});

// --- Homebrew --------------------------------------------------------------------
const cask = homebrewCask({ version: '0.4.5', arm: { hash: 'a'.repeat(64) }, intel: { hash: 'b'.repeat(64) } });

check('the cask carries a checksum for each architecture', () => {
  assert.match(cask, new RegExp(`arm:\\s+"${'a'.repeat(64)}"`));
  assert.match(cask, new RegExp(`intel: "${'b'.repeat(64)}"`));
});

check('the cask URL is built from the version and architecture', () => {
  assert.match(cask, /Neuron-#\{version\}-mac-#\{arch\}\.dmg/);
  assert.match(cask, /version "0\.4\.5"/);
});

check('the cask declares both architectures', () => {
  assert.match(cask, /arch arm: "arm64", intel: "x64"/);
});

check('uninstalling cleans up after itself', () => {
  assert.match(cask, /zap trash:/);
});

// --- the property that ties them together ------------------------------------
check('all three publish the same version from one release', () => {
  const version = '1.2.3';
  const w = wingetManifests({ version, url: 'u', hash: HASH });
  const c = chocolateyPackage({ version, url: 'u', hash: HASH });
  const h = homebrewCask({ version, arm: { hash: 'a'.repeat(64) }, intel: { hash: 'b'.repeat(64) } });
  assert.match(w[`${IDENTIFIER}.yaml`], /PackageVersion: 1\.2\.3/);
  assert.match(c['neuron.nuspec'], /<version>1\.2\.3<\/version>/);
  assert.match(h, /version "1\.2\.3"/);
});

check('the Windows checksum is shared, not computed twice', () => {
  const w = wingetManifests({ version: '1.0.0', url: 'u', hash: HASH });
  const c = chocolateyPackage({ version: '1.0.0', url: 'u', hash: HASH });
  assert.ok(w[`${IDENTIFIER}.installer.yaml`].includes(HASH.toUpperCase()));
  assert.ok(c['tools/chocolateyinstall.ps1'].includes(HASH));
});

console.log(`\nrelease-manifests: ${checks} checks passed`);
