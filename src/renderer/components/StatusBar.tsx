type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface StatusBarProps {
  activeNote: string | null;
  saveState: SaveState;
}

const saveText: Record<SaveState, string> = {
  idle: 'Ready',
  saving: 'Saving…',
  saved: 'Saved locally',
  error: 'Save failed',
};

// No workspace name here: the switcher in the toolbar and the explorer heading
// already say which workspace is open, and a third copy was one too many.
export default function StatusBar({ activeNote, saveState }: StatusBarProps) {
  return (
    <footer className="status-bar flex select-none items-center justify-between px-3 font-sans text-[11px] text-[var(--ink-muted)]">
      <div className="flex min-w-0 items-center gap-3">
        {activeNote && (
          <span className={`flex items-center gap-1.5 ${saveState === 'error' ? 'text-[var(--danger)]' : ''}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${saveState === 'error' ? 'bg-[var(--danger)]' : saveState === 'saving' ? 'bg-[var(--warning)]' : 'bg-[var(--positive)]'}`} />
            {saveText[saveState]}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span>UTF-8</span>
        <span>Markdown</span>
      </div>
    </footer>
  );
}
