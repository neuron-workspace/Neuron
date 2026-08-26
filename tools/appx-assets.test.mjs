// The Store package must carry Neuron's own tiles.
//
//   node tools/appx-assets.test.mjs                 checks build/appx
//   node tools/appx-assets.test.mjs path/to.appx    also checks the package
//
// 0.4.4-beta.3 was rejected under certification rule 10.1.1.11, "app must not
// use default or placeholder images". electron-builder looks for a directory
// named `appx` under buildResources and, finding none, silently substitutes its
// own sample images -- so the package shipped the Electron atom on every tile
// and nothing in the build said a word about it.
//
// The failure mode worth defending against is that silence. A missing directory
// does not break the build; it changes what the build produces.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'build', 'appx');

// The exact images electron-builder substitutes, taken from the package
// Microsoft rejected. Matching one of these by content is the precise
// definition of the defect, so it is checked by identity rather than by guess.
const ELECTRON_DEFAULTS = new Map([
  ['b6d709ba362df5eb3fd7bb11616ecaede1a8c6228b366d06e8b1da0dd3e63bda', 'Square150x150Logo (SampleAppx.150x150)'],
  ['8bac33b74a3c76f3e8eb04de0f0bdb56c439398ccdc9c61811a12c62ac059327', 'Square44x44Logo (SampleAppx.44x44)'],
  ['ebda946cecc7a2b3569be328ab4b785091a2c7c48a28bb719e97af22575aeb35', 'StoreLogo (SampleAppx.50x50)'],
  ['f93fbe8780cfe89a7aa8065d71765fda49b48718e4aae17bbb0e99da4baedb23', 'Wide310x150Logo (SampleAppx.310x150)'],
]);

// name -> [width, height] at 100% scale. LargeTile and SmallTile are
// electron-builder's spellings for Square310x310Logo and Square71x71Logo.
const REQUIRED = {
  'Square44x44Logo.png': [44, 44],
  'Square150x150Logo.png': [150, 150],
  'SmallTile.png': [71, 71],
  'LargeTile.png': [310, 310],
  'Wide310x150Logo.png': [310, 150],
  'StoreLogo.png': [50, 50],
};
const SCALES = [125, 150, 200, 400];
const REQUIRED_TARGET_SIZES = [16, 24, 32, 48, 256];

/** Width and height straight out of the PNG IHDR chunk. */
function pngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not a PNG');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Read a zip without adding a dependency.
 *
 * An .appx is an ordinary zip. Node ships inflate but no archive reader, and a
 * package this size does not justify one: walk the central directory, then
 * inflate the entries actually wanted.
 */
function readZip(file) {
  const buf = readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.notEqual(eocd, -1, 'no zip end-of-central-directory record');

  let count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  // makeappx writes Zip64, so the 32-bit fields above are sentinels and the
  // real values live in the Zip64 record the locator points at.
  if (p === 0xffffffff || count === 0xffff) {
    let locator = -1;
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x07064b50) { locator = i; break; }
    }
    assert.notEqual(locator, -1, 'zip claims Zip64 but has no locator');
    const z64 = Number(buf.readBigUInt64LE(locator + 8));
    assert.equal(buf.readUInt32LE(z64), 0x06064b50, 'bad Zip64 end-of-central-directory record');
    count = Number(buf.readBigUInt64LE(z64 + 32));
    p = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const entries = new Map();

  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    let compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // Zip64 moves any field that overflowed into an extra block, in the order
    // the overflowed fields appear in the record.
    if (compressed === 0xffffffff || localOffset === 0xffffffff) {
      const extraStart = p + 46 + nameLen;
      for (let e = extraStart; e < extraStart + extraLen; ) {
        const id = buf.readUInt16LE(e);
        const size = buf.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressed === 0xffffffff) q += 8;
          if (compressed === 0xffffffff) { compressed = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (localOffset === 0xffffffff) localOffset = Number(buf.readBigUInt64LE(q));
          break;
        }
        e += 4 + size;
      }
    }

    entries.set(name, () => {
      assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, `bad local header for ${name}`);
      const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      const raw = buf.subarray(start, start + compressed);
      return method === 0 ? raw : inflateRawSync(raw);
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function expectedNames() {
  const names = new Set(Object.keys(REQUIRED));
  for (const base of Object.keys(REQUIRED)) {
    for (const scale of SCALES) names.add(base.replace('.png', `.scale-${scale}.png`));
  }
  for (const size of REQUIRED_TARGET_SIZES) {
    names.add(`Square44x44Logo.targetsize-${size}.png`);
    names.add(`Square44x44Logo.targetsize-${size}_altform-unplated.png`);
  }
  return names;
}

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

// --- the source assets -----------------------------------------------------
console.log('build/appx:');

check('the appx asset directory exists', () => {
  assert.ok(
    existsSync(assetsDir),
    'build/appx is missing — electron-builder will silently ship its own sample tiles.\n'
    + 'Regenerate with: python tools/appx-assets.py',
  );
});

const present = new Set(readdirSync(assetsDir).filter((f) => f.endsWith('.png')));

check('every required tile and variant is present', () => {
  const missing = [...expectedNames()].filter((name) => !present.has(name)).sort();
  assert.deepEqual(missing, [], `missing tiles: ${missing.join(', ')}`);
});

check('every tile has the dimensions its name claims', () => {
  for (const [name, [w, h]] of Object.entries(REQUIRED)) {
    assert.deepEqual(pngSize(readFileSync(join(assetsDir, name))), [w, h], `${name} is the wrong size`);
    for (const scale of SCALES) {
      const scaled = name.replace('.png', `.scale-${scale}.png`);
      assert.deepEqual(
        pngSize(readFileSync(join(assetsDir, scaled))),
        [Math.round(w * scale / 100), Math.round(h * scale / 100)],
        `${scaled} is the wrong size`,
      );
    }
  }
  for (const size of REQUIRED_TARGET_SIZES) {
    for (const suffix of ['', '_altform-unplated']) {
      const name = `Square44x44Logo.targetsize-${size}${suffix}.png`;
      assert.deepEqual(pngSize(readFileSync(join(assetsDir, name))), [size, size], `${name} is the wrong size`);
    }
  }
});

check('no asset is an electron-builder default', () => {
  for (const name of present) {
    const was = ELECTRON_DEFAULTS.get(sha256(readFileSync(join(assetsDir, name))));
    assert.ok(!was, `${name} is still electron-builder's ${was}`);
  }
});

// --- the built package, when there is one ----------------------------------
const packagePath = process.argv[2]
  ?? (existsSync(join(root, 'release'))
    ? readdirSync(join(root, 'release')).filter((f) => f.endsWith('.appx')).map((f) => join(root, 'release', f))[0]
    : undefined);

if (!packagePath) {
  console.log('\nno .appx given or found in release/ — source assets only');
} else {
  console.log(`\n${packagePath}:`);
  const entries = readZip(packagePath);
  const packaged = [...entries.keys()].filter((n) => n.toLowerCase().startsWith('assets/'));

  check('the package carries every required tile', () => {
    const missing = [...expectedNames()].filter((n) => !entries.has(`assets/${n}`)).sort();
    assert.deepEqual(missing, [], `not packaged: ${missing.join(', ')}`);
  });

  check('no packaged asset is an electron-builder default', () => {
    for (const name of packaged) {
      const was = ELECTRON_DEFAULTS.get(sha256(entries.get(name)()));
      assert.ok(!was, `${name} is still electron-builder's ${was}`);
    }
  });

  check('the manifest points only at assets that exist', () => {
    const manifest = entries.get('AppxManifest.xml')().toString('utf8');
    const referenced = [...new Set([...manifest.matchAll(/[Aa]ssets[\\/]([\w.\-]+\.png)/g)].map((m) => m[1]))];
    assert.ok(referenced.length > 0, 'the manifest references no images at all');
    for (const name of referenced) {
      assert.ok(entries.has(`assets/${name}`), `manifest references assets\\${name}, which is not in the package`);
      assert.ok(present.has(name), `manifest references assets\\${name}, which build/appx does not provide`);
    }
    console.log(`      manifest references: ${referenced.sort().join(', ')}`);
  });
}

console.log(`\nappx assets: ${checks} checks passed`);
