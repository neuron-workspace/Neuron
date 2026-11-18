import { useMemo } from 'react';
import { MoveHorizontal } from 'lucide-react';
import { isFullWidth, parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter';

/**
 * The note header's "Full width" button. It writes `fullWidth: true` into the
 * note's properties, or takes it out, through the same serializer the
 * properties panel uses, so comments and other keys stay as they were.
 */
export default function FullWidthToggle({ doc, onChange, removeEmpty = true }: { doc: string; onChange: (next: string) => void; removeEmpty?: boolean }) {
  const parsed = useMemo(() => parseFrontmatter(doc), [doc]);
  const on = isFullWidth(parsed.data);
  // Rewriting a block that does not parse would throw away what is in it.
  const broken = parsed.hasFrontmatter && !parsed.valid;
  const toggle = () => {
    const entries = parsed.properties.filter((p) => p.key !== 'fullWidth').map((p) => ({ key: p.key, value: p.value }));
    onChange(serializeFrontmatter(doc, on ? entries : [...entries, { key: 'fullWidth', value: true }], { removeEmpty }));
  };
  return (
    <button
      type="button"
      aria-label="Full width"
      aria-pressed={on}
      disabled={broken}
      title={broken ? 'Fix the properties block to change the width' : on ? 'Use the reading width' : 'Use the full width'}
      onClick={toggle}
      className="interactive inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] disabled:opacity-45 aria-pressed:border-[var(--divider)] aria-pressed:bg-[var(--canvas)] aria-pressed:text-[var(--ink)]"
    >
      <MoveHorizontal className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
