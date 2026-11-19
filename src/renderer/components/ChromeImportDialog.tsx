import { useState } from 'react';
import { normalizeCookieDomain } from '../../main/cookie-domain';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

export default function ChromeImportDialog({ open, onOpenChange, onImported }: {
  open: boolean; onOpenChange: (open: boolean) => void; onImported: (message: string) => void;
}) {
  const [site, setSite] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const domain = normalizeCookieDomain(site.trim());
    if (!domain) { setError('Enter a hostname such as github.com, without a scheme or path.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.cookies.importChrome(domain);
      if (!result.success) { setError(result.error ?? 'Chrome import failed. Try again.'); return; }
      onImported(`Imported ${result.imported ?? 0} Chrome cookies for ${domain}${result.skipped ? ` (${result.skipped} skipped)` : ''}. Open a website tab to use them.`);
      onOpenChange(false);
      setSite('');
    } catch {
      setError('Chrome import failed. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setError(''); onOpenChange(next); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Chrome logins</DialogTitle>
          <DialogDescription>Import cookies for one site and its subdomains into Neuron’s website tabs.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="chrome-import-site" className="text-sm font-medium">Site hostname</label>
          <Input id="chrome-import-site" placeholder="github.com" value={site} disabled={busy} autoComplete="off" spellCheck={false}
            aria-invalid={!!error} aria-describedby={error ? 'chrome-import-error' : undefined} onChange={(event) => { setSite(event.target.value); setError(''); }} />
          {error && <p id="chrome-import-error" role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !site}>{busy ? 'Importing…' : 'Import logins'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
