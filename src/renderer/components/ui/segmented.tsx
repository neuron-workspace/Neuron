import type { ReactNode } from 'react';

/**
 * The app's one this-or-that switch.
 *
 * Before this there were three: a dropdown of checkbox items for the editor's
 * view modes, a row of bare buttons for the same three modes in a layout
 * workspace, and `.mode-switch` for surfaces and databases. Same decision, three
 * shapes, three sets of words -- the thing the product register calls out by
 * name. The styling lives in index.css so a caller cannot drift from it.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Why the option is unavailable. Shown on hover; a disabled control that
      does not say why is a dead end. */
  title?: string;
}

interface SegmentedProps<T extends string> {
  /** Names the group for screen readers, e.g. "View mode". */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ label, value, options, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={`segmented${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.title}
          className="interactive"
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default Segmented;
