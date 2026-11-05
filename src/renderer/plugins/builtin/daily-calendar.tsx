import { CalendarDays, Plus } from 'lucide-react';
import type { HostRuntime, PluginModule } from '../types';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';

function todayPath(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `daily/${stamp}.mdx`;
}

async function openOrCreateToday(host: HostRuntime) {
  const path = todayPath();
  if (host.notes.includes(path)) {
    host.openNote(path);
    return;
  }
  const heading = path.replace('daily/', '').replace('.mdx', '');
  const created = await host.createNote(path, `# ${heading}\n\n## Today\n\n- \n\n## Notes\n\n`);
  if (created) host.openNote(path);
}

function DailyPanel({ host }: { host: HostRuntime }) {
  const dailyNotes = host.notes.filter((n) => n.startsWith('daily/')).sort().reverse();
  const formatted = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--divider)] p-3">
        <div className="text-[11px] font-medium text-[var(--ink-muted)]">Today</div>
        <div className="mt-0.5 text-sm font-medium text-[var(--ink)]">{formatted}</div>
        <Button size="sm" className="mt-3 w-full" onClick={() => void openOrCreateToday(host)}>
          <Plus className="h-3.5 w-3.5" /> Open today&apos;s note
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          <div className="px-2 pb-1.5 pt-1 text-[11px] text-[var(--ink-muted)]">Recent daily notes</div>
          {dailyNotes.length === 0 && (
            <p className="px-2 py-6 text-center text-xs leading-5 text-[var(--ink-muted)]">No daily notes yet. Create one above.</p>
          )}
          {dailyNotes.map((note) => (
            <button
              key={note}
              onClick={() => host.openNote(note)}
              className="interactive flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
              <span className="truncate font-mono text-xs">{note.replace('daily/', '').replace('.mdx', '')}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

const dailyCalendar: PluginModule = {
  manifest: {
    id: 'daily-calendar',
    name: 'Daily Notes',
    version: '1.0.0',
    author: 'Neuron',
    description: 'A date-based journal: open or create a note for today and browse recent entries. A non-AI integration example.',
    category: 'integration',
  },
  activate(host) {
    host.registerPanel({
      id: 'daily-calendar.panel',
      title: 'Daily',
      icon: CalendarDays,
      render: (runtime) => <DailyPanel host={runtime} />,
    });
    host.registerCommand({
      id: 'daily-calendar.open-today',
      title: "Open today's daily note",
      run: (runtime) => void openOrCreateToday(runtime),
    });
  },
};

export default dailyCalendar;
