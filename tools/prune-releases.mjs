// Delete the releases a new tag supersedes.
//
//   node tools/prune-releases.mjs v0.4.4-beta.3        (deletes)
//   node tools/prune-releases.mjs v0.4.4 --dry-run     (prints only)
//
// This used to be a shell loop inside release.yml, where nothing could test it.
// It deletes published releases and their tags, so it is the last thing in this
// repository that should be unverifiable -- and it was wrong: matching on
// "everything before the last dot" made `0.4.4-beta` its own series, so
// shipping 0.4.4 left every 0.4.4-beta.N behind while reporting success.
import { execFileSync } from 'node:child_process';

/**
 * A tag's release series and its position within it.
 *
 *   v0.4.4-beta.2  ->  { series: '0.4.4', rank: 2 }     a prerelease
 *   v0.4.4         ->  { series: '0.4.4', rank: null }  the release itself
 *
 * `rank: null` means "final", which is why a finished release supersedes every
 * prerelease of the same version and no prerelease ever supersedes it.
 */
export function parseTag(tag) {
  const version = String(tag).replace(/^v/, '');
  const series = version.split('-')[0];
  if (!version.includes('-')) return { series, rank: null };

  const last = version.slice(version.lastIndexOf('.') + 1);
  return { series, rank: /^\d+$/.test(last) ? Number(last) : NaN };
}

/** Which of `tags` the release `tag` replaces. */
export function supersededBy(tag, tags) {
  const { series, rank } = parseTag(tag);
  if (Number.isNaN(rank)) return [];

  return tags.filter((other) => {
    if (other === tag) return false;
    const parsed = parseTag(other);
    if (parsed.series !== series) return false;
    if (Number.isNaN(parsed.rank)) return false;
    // A final release clears out the prereleases that led to it.
    if (rank === null) return parsed.rank !== null;
    // A prerelease only clears out earlier prereleases, never the final one.
    return parsed.rank !== null && parsed.rank < rank;
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`
  || import.meta.url.endsWith(String(process.argv[1]).replace(/\\/g, '/'));

if (isMain) {
  const tag = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!tag) {
    console.error('usage: node tools/prune-releases.mjs <tag> [--dry-run]');
    process.exit(1);
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf-8' });

  const listed = gh(['release', 'list', ...(repo ? ['--repo', repo] : []),
    '--limit', '200', '--json', 'tagName', '--jq', '.[].tagName'])
    .split('\n').map((line) => line.trim()).filter(Boolean);

  const doomed = supersededBy(tag, listed);
  if (doomed.length === 0) {
    console.log(`Nothing superseded by ${tag}.`);
    process.exit(0);
  }

  for (const other of doomed) {
    console.log(`Pruning ${other} — superseded by ${tag}`);
    if (dryRun) continue;
    gh(['release', 'delete', other, ...(repo ? ['--repo', repo] : []), '--cleanup-tag', '--yes']);
  }
}
