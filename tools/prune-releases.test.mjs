// What a new tag is allowed to delete.
//
// This guards a destructive operation: the release workflow runs it with real
// credentials and it removes published releases and their tags. The bug it was
// written against is the last case but one -- shipping a finished 0.4.4 used to
// prune nothing, because `0.4.4-beta` was treated as a different series from
// `0.4.4`.
import assert from 'node:assert';
import { parseTag, supersededBy } from './prune-releases.mjs';

// --- parsing ---------------------------------------------------------------
assert.deepEqual(parseTag('v0.4.4-beta.2'), { series: '0.4.4', rank: 2 }, 'prerelease');
assert.deepEqual(parseTag('v0.4.4'), { series: '0.4.4', rank: null }, 'final release');
assert.deepEqual(parseTag('0.4.4-beta.10'), { series: '0.4.4', rank: 10 }, 'a leading v is optional');
assert.ok(Number.isNaN(parseTag('v0.4.4-rc').rank), 'a prerelease with no number is unparseable');

// --- what each tag supersedes ---------------------------------------------
const cases = [
  {
    what: 'a beta prunes only earlier betas of its own version',
    tag: 'v0.4.4-beta.3',
    tags: ['v0.4.4-beta.1', 'v0.4.4-beta.2', 'v0.4.3', 'v0.4.2-beta.1'],
    expect: ['v0.4.4-beta.1', 'v0.4.4-beta.2'],
  },
  {
    what: 'a finished release prunes every prerelease that led to it',
    tag: 'v0.4.4',
    tags: ['v0.4.4-beta.1', 'v0.4.4-beta.2', 'v0.4.4-beta.3', 'v0.4.3'],
    expect: ['v0.4.4-beta.1', 'v0.4.4-beta.2', 'v0.4.4-beta.3'],
  },
  {
    what: 'a finished release leaves other versions alone',
    tag: 'v0.4.4',
    tags: ['v0.4.3', 'v0.4.2-beta.1', 'v0.5.0-beta.1'],
    expect: [],
  },
  {
    what: 'an earlier beta cannot prune a later one',
    tag: 'v0.4.4-beta.1',
    tags: ['v0.4.4-beta.2', 'v0.4.4-beta.3'],
    expect: [],
  },
  {
    what: 'a beta never prunes the finished release',
    tag: 'v0.4.4-beta.5',
    tags: ['v0.4.4'],
    expect: [],
  },
  {
    what: 'ranks compare as numbers, not as text',
    tag: 'v0.4.4-beta.10',
    tags: ['v0.4.4-beta.9'],
    expect: ['v0.4.4-beta.9'],
  },
  {
    what: 'a tag never prunes itself',
    tag: 'v0.4.4-beta.2',
    tags: ['v0.4.4-beta.2'],
    expect: [],
  },
  {
    what: 'an unparseable tag prunes nothing at all',
    tag: 'v0.4.4-rc',
    tags: ['v0.4.4-beta.1', 'v0.4.4-beta.2'],
    expect: [],
  },
];

for (const { what, tag, tags, expect } of cases) {
  assert.deepEqual(supersededBy(tag, tags), expect, what);
}

console.log(`prune-releases: ${cases.length + 4} assertions passed`);
