// Check a built .appx before uploading it to Partner Center.
//
//   node tools/verify-appx.mjs [path/to/Neuron-x.y.z-win-x64.appx]
//
// Every field below has already been wrong once. The identity was still
// REPLACE.WITH placeholders because two electron-builder configs had drifted,
// and the display name was the product's name rather than the reserved one,
// which Partner Center rejected with "uses a display name that you have not
// reserved". Both were invisible until something else told us — a manifest
// read takes a second and says so here instead.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const want = pkg.build.appx;

function findPackage() {
  if (process.argv[2]) return resolve(process.argv[2]);
  for (const dir of [join(root, 'release', 'prod'), join(root, 'release')]) {
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).find((f) => f.endsWith('.appx'));
    if (hit) return join(dir, hit);
  }
  return null;
}

const file = findPackage();
if (!file || !existsSync(file)) {
  console.error('No .appx found. Build one with `npm run dist:store`, or pass a path.');
  process.exit(1);
}

// An .appx is a zip. Reading one entry needs no dependency on any platform
// that ships tar/powershell, and this only ever runs on a developer machine.
function readManifest(appx) {
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      `$z=[System.IO.Compression.ZipFile]::OpenRead('${appx.replace(/'/g, "''")}');`,
      "$e=$z.Entries | Where-Object { $_.FullName -eq 'AppxManifest.xml' };",
      '$r=New-Object System.IO.StreamReader($e.Open());',
      '$r.ReadToEnd(); $r.Close(); $z.Dispose()',
    ].join(' ');
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
  }
  return execFileSync('unzip', ['-p', appx, 'AppxManifest.xml'], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
}

const xml = readManifest(file);
const attr = (tag, name) => xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`))?.[1] ?? null;
const text = (tag) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? null;

const found = {
  'Identity/Name': attr('Identity', 'Name'),
  'Identity/Publisher': xml.match(/<Identity\b[^>]*\bPublisher='([^']*)'/)?.[1] ?? attr('Identity', 'Publisher'),
  'Identity/Version': attr('Identity', 'Version'),
  'Properties/DisplayName': text('DisplayName'),
  'Properties/PublisherDisplayName': text('PublisherDisplayName'),
};

const expected = {
  'Identity/Name': want.identityName,
  'Identity/Publisher': want.publisher,
  'Properties/DisplayName': want.displayName,
  'Properties/PublisherDisplayName': want.publisherDisplayName,
};

let failed = 0;
console.log(`\n${file}\n`);
for (const [field, value] of Object.entries(found)) {
  const target = expected[field];
  if (target === undefined) { console.log(`  ..  ${field.padEnd(32)} ${value}`); continue; }
  const ok = value === target;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok' : 'XX'}  ${field.padEnd(32)} ${value}${ok ? '' : `   (expected ${target})`}`);
}

// The Store will not accept a placeholder or a prerelease version.
if (/REPLACE/i.test(JSON.stringify(found))) {
  console.error('\n  XX  a REPLACE.WITH placeholder reached the manifest');
  failed++;
}
if (!/^\d+\.\d+\.\d+\.0$/.test(found['Identity/Version'] ?? '')) {
  console.error(`\n  XX  version must be four numeric parts ending in .0, got ${found['Identity/Version']}`);
  failed++;
}

console.log(
  failed
    ? `\n${failed} problem(s). Fix package.json build.appx and rebuild before uploading.\n`
    : '\nManifest matches package.json.\n\n'
      + 'One thing this cannot check: whether Properties/DisplayName is a name you\n'
      + 'actually reserved in Partner Center. It only knows what you configured.\n'
      + 'Partner Center -> your app -> Product management -> Manage app names.\n',
);
process.exit(failed ? 1 : 0);
