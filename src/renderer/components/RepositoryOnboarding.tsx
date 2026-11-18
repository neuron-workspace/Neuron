import { useEffect, useRef } from 'react';
import { FolderOpen, FolderPlus } from 'lucide-react';

interface RepositoryOnboardingProps {
  onCreate: () => void;
  onOpen: () => void;
}

const CHOICE = 'interactive flex flex-1 flex-col items-start gap-1 rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-5 text-left hover:border-[color-mix(in_oklch,var(--accent)_40%,var(--divider))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

/** Shown in a window with no workspace: two ways in, nothing else. */
export default function RepositoryOnboarding({ onCreate, onOpen }: RepositoryOnboardingProps) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-[var(--canvas)] px-6 py-10">
      <div className="w-full max-w-xl">
        <h1 className="text-center text-2xl font-semibold tracking-[-0.01em] text-[var(--ink)]">Welcome to Neuron</h1>
        <div className="mt-8 flex flex-col gap-3 min-[560px]:flex-row">
          <button ref={first} type="button" onClick={onOpen} className={CHOICE}>
            <FolderOpen className="h-5 w-5 text-[var(--accent-strong)]" aria-hidden="true" />
            <span className="mt-2 text-sm font-semibold text-[var(--ink)]">Open existing folder</span>
            <span className="text-xs leading-5 text-[var(--ink-secondary)]">Pick a folder of notes you already have.</span>
          </button>
          <button type="button" onClick={onCreate} className={CHOICE}>
            <FolderPlus className="h-5 w-5 text-[var(--accent-strong)]" aria-hidden="true" />
            <span className="mt-2 text-sm font-semibold text-[var(--ink)]">Create new workspace</span>
            <span className="text-xs leading-5 text-[var(--ink-secondary)]">Start an empty folder for new notes.</span>
          </button>
        </div>
      </div>
    </div>
  );
}
