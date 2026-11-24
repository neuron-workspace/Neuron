import { useEffect, useState } from 'react';
import type { WorkspaceTemplate } from '../electron.d';

/** How starting from a template ended: the dialog closes only on 'created'. */
export type TemplateStart = 'created' | 'cancelled' | 'failed';

/** The bundled templates, and starting a workspace from one. Shared by onboarding and Settings. */
export function useWorkspaceTemplates() {
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.electronAPI?.templates.list().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const start = async (template: WorkspaceTemplate): Promise<TemplateStart> => {
    setError(null);
    setBusy(template.id);
    try {
      const result = await window.electronAPI.templates.create(template.id);
      // null means the folder picker was dismissed, which is not an error. On
      // success main opens the workspace, and App is already listening for
      // that — nothing to do here but stop showing the spinner.
      if (result?.error) { setError(result.error); return 'failed'; }
      return result?.repository ? 'created' : 'cancelled';
    } catch (err) {
      setError((err as Error).message);
      return 'failed';
    } finally {
      setBusy(null);
    }
  };

  /** Forget the last error, as the dialog closes. */
  const clearError = () => setError(null);

  return { templates, busy, error, start, clearError };
}
