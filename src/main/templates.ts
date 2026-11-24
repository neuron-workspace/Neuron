// Workspace templates.
//
// A template is a folder that gets copied into wherever the user chooses. That
// is the whole model: adding one means dropping a directory into `examples/`,
// with no code change and no registry to keep in step. `examples` is already
// copied into the packaged app as extraResources, so a new template ships with
// the next build automatically.
//
// A template may describe itself in `template.json`:
//
//   { "name": "Research vault", "description": "Sources, notes and a reading log" }
//
// Without one it is still a valid template; the folder name is used instead.
// The point is that a template is data, not a code path.
import * as fs from 'fs';
import * as path from 'path';

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  /** Absolute path to the folder that gets copied. */
  source: string;
  /** Roughly how much is in it, so the chooser can say. */
  noteCount: number;
}

/** Where templates live, packaged or not. */
export function templatesRoot(isPackaged: boolean, resourcesPath: string): string {
  return isPackaged
    ? path.join(resourcesPath, 'examples')
    : path.join(process.cwd(), 'examples');
}

const titleCase = (slug: string) =>
  slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

function countNotes(dir: string, budget = 400): number {
  let seen = 0;
  const walk = (current: string) => {
    if (seen >= budget) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (seen >= budget) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|mdx)$/i.test(entry.name)) seen += 1;
    }
  };
  walk(dir);
  return seen;
}

export function listTemplates(root: string): WorkspaceTemplate[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const source = path.join(root, entry.name);
      let name = titleCase(entry.name);
      let description = '';
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(source, 'template.json'), 'utf-8')) as
          { name?: string; description?: string };
        if (typeof meta.name === 'string' && meta.name.trim()) name = meta.name.trim();
        if (typeof meta.description === 'string') description = meta.description.trim();
      } catch { /* a template need not describe itself */ }
      return { id: entry.name, name, description, source, noteCount: countNotes(source) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copy a template into an empty-ish destination.
 *
 * `template.json` is deliberately left behind: it describes the template, not
 * the workspace made from it, and copying it would put a file in the user's
 * notes that only means something to the chooser they just used.
 */
export function copyTemplate(source: string, destination: string, now = new Date()): void {
  fs.mkdirSync(destination, { recursive: true });
  const shift = path.basename(source) === 'demo-repo' ? demoDateShift(source, now) : 0;
  const shiftDates = (text: string) => text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (day) => {
    const time = calendarTime(day);
    return time === null ? day : new Date(time + shift).toISOString().slice(0, 10);
  });

  const walk = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name === 'template.json' && from === source) continue;
      const src = path.join(from, entry.name);
      const isNote = /\.(md|mdx|db)$/i.test(entry.name);
      const dst = path.join(to, shift && isNote ? shiftDates(entry.name) : entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        walk(src, dst);
      } else if (entry.isFile()) {
        if (shift && isNote) fs.writeFileSync(dst, shiftDates(fs.readFileSync(src, 'utf8')), 'utf8');
        else fs.copyFileSync(src, dst);
      }
    }
  };

  walk(source, destination);
}

function calendarTime(day: string): number | null {
  const time = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : null;
}

/** All demo dates move together; the latest task due date lands a week from creation. */
function demoDateShift(source: string, now: Date): number {
  let latestDue = -Infinity;
  let latestDate = -Infinity;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(md|mdx|db)$/i.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) latestDate = Math.max(latestDate, calendarTime(match[0]) ?? -Infinity);
        if (/\.db$/i.test(entry.name)) {
          for (const match of text.matchAll(/"due"\s*:\s*"(\d{4}-\d{2}-\d{2})"/g)) latestDue = Math.max(latestDue, calendarTime(match[1]) ?? -Infinity);
        }
      }
    }
  };
  walk(source);
  const anchor = Number.isFinite(latestDue) ? latestDue : latestDate;
  return Number.isFinite(anchor) ? Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 7) - anchor : 0;
}

/** Whether a folder already holds notes, so the caller can refuse to write over them. */
export function hasNotes(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((name) => /\.(md|mdx|db|canvas)$/i.test(name));
  } catch {
    return false;
  }
}
