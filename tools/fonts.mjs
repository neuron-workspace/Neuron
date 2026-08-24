// Pull the latin subsets of the two site faces and rewrite the CSS to point at
// local copies. The download page tells visitors the product makes no network
// calls; loading its own fonts from Google contradicts that on the very page
// making the claim.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'C:/Workspace/Projects/Neuron/app';
const out = join(root, 'docs', 'fonts');
mkdirSync(out, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap';

const css = await fetch(CSS_URL, { headers: { 'User-Agent': UA } }).then((r) => r.text());

// Latin and latin-ext only. The site ships English; shipping Cyrillic and
// Vietnamese subsets nobody requests is weight for nothing.
const blocks = css.split('@font-face').slice(1).map((b) => '@font-face' + b);
const keep = blocks.filter((b) => /\/\* latin/.test(css.slice(0, css.indexOf(b))) || true)
  .filter((b) => {
    const range = b.match(/unicode-range:\s*([^;]+);/)?.[1] ?? '';
    // Latin only. The site ships English; latin-ext doubled the payload for
    // accents that appear nowhere on the page, and the fallback stack covers
    // them if a release filename ever carries one.
    return range.includes('U+0000-00FF');
  });

let outCss = '/* Self-hosted so the download page makes no third-party request.\n'
  + '   Regenerate with: node tools/fonts.mjs\n'
  + '   Archivo and Source Serif 4 are both SIL Open Font License 1.1. */\n\n';

let n = 0;
for (const block of keep) {
  const url = block.match(/url\((https:[^)]+)\)/)?.[1];
  const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
  const weight = block.match(/font-weight:\s*([^;]+);/)?.[1].trim();
  if (!url || !family) continue;

  const slug = `${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${weight.replace(/\s+/g, '_')}-${n++}.woff2`;
  const bytes = Buffer.from(await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => r.arrayBuffer()));
  writeFileSync(join(out, slug), bytes);

  outCss += block.replace(/url\(https:[^)]+\)/, `url(./fonts/${slug})`).trim() + '\n\n';
  console.log(`${slug.padEnd(34)} ${(bytes.length / 1024).toFixed(1)} KB  (${family} ${weight})`);
}

writeFileSync(join(root, 'docs', 'fonts.css'), outCss);
console.log(`\nwrote docs/fonts.css with ${n} faces`);
