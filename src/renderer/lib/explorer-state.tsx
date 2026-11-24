import * as React from 'react';
import type { RecentEntry } from './workspace-explorer';

/**
 * The explorer's state, shared by the two places an editor area can be empty.
 *
 * There are two: the plain shell, where a note fills the pane, and the layout
 * shell, where a note fills an `editor` panel among others. Both had their own
 * blank state, and the explorer has to replace both -- a workspace with a
 * .neuron/layout.json is not a workspace that should keep the old empty text.
 *
 * A context rather than props threaded through the panel registry, because
 * panels are looked up by name and given a fixed PanelContext; widening that
 * for one panel would make every panel carry explorer state it has no use for.
 *
 * Two consumers, one state: navigating in one and returning through the other
 * lands in the same folder, and there is one Recent list rather than two that
 * drift.
 */
export interface ExplorerState {
  /**
   * The user asked for the explorer while something is still open.
   *
   * Separate from "nothing is selected" because both empty-editor hosts need to
   * honour it: the plain shell shows the explorer instead of the note, and the
   * layout shell's editor panel does the same rather than carrying on
   * displaying the note the user just navigated away from.
   */
  atHome: boolean;
  repositoryName: string;
  /** Every note path in the workspace. */
  paths: string[];
  /** Files Neuron does not open. Listed and selectable, never opened. */
  otherFiles: string[];
  fileInfo: Record<string, { size: number; modified: number }>;
  /** Entries the listing could not read. */
  skipped: number;
  /** The listing stopped at its limit. */
  truncated: boolean;
  /** Show a file in the system file manager. */
  reveal: (path: string) => void;
  /** '' is the workspace root. */
  folder: string;
  navigate: (folder: string) => void;
  openFile: (path: string) => void;
  folders: string[];
  notesData: { path: string; content: string }[];
  createNote: (path: string, content?: string, companions?: { path: string; content: string }[]) => Promise<boolean>;
  createFolder: (path: string) => Promise<boolean>;
  openToSide?: (path: string) => void;
  editorModes: Record<string, 'reading' | 'live' | 'split'>;
  recents: RecentEntry[];
  clearRecents: () => void;
  /** Rename (F2) or Move to… a file or folder. */
  fileAction?: (action: { kind: 'rename' | 'move'; path: string; folder: boolean }) => void;
  /** A file or folder dropped onto a folder. */
  moveInto?: (path: string, folder: string) => void;
}

const ExplorerContext = React.createContext<ExplorerState | null>(null);

export function ExplorerProvider({ value, children }: { value: ExplorerState; children: React.ReactNode }) {
  return <ExplorerContext.Provider value={value}>{children}</ExplorerContext.Provider>;
}

/** Null outside the provider, so a panel can fall back rather than crash. */
export function useExplorer(): ExplorerState | null {
  return React.useContext(ExplorerContext);
}
