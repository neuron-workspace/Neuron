// The stylesheet served to every HTMX view as `neuron.css`. It is a small,
// shadcn-inspired component library: a token system (light/dark), semantic
// element defaults (a bare <section> is a card, <button> a button, <input>/
// <table> styled), and explicit component classes — cards (.card/.card-header/
// .card-title/.card-content/.card-footer), buttons (.btn + variants/sizes),
// .badge, .input, .label, .separator, .grid, .metric. The legacy `.neuron-*`
// classes are kept as aliases so server-rendered fragments keep working.
//
// Every selector is scoped under `.neuron-view` for predictable specificity:
// component classes reliably override the bare-element defaults.
//
// Embedded as a string so the packaged app needs no extra asset plumbing.

export const NEURON_VIEW_CSS = `
:root { color-scheme: light dark; }
*, *::before, *::after { box-sizing: border-box; }

body.neuron-view {
  /* shadcn-style tokens */
  --background: #f7f7f6;
  --foreground: #191919;
  --card: #ffffff;
  --card-foreground: #191919;
  --primary: #3d7a5b;
  --primary-foreground: #ffffff;
  --primary-hover: #336a4e;
  --secondary: #f1f1ef;
  --secondary-foreground: #27272a;
  --muted: #f1f1ef;
  --muted-foreground: #676763;
  --subtle: #ececeb;
  --border: #e6e6e2;
  --input: #dcdcd7;
  --ring: #3d7a5b;
  --destructive: #c0392b;
  --destructive-foreground: #ffffff;
  --radius: 0.65rem;
  --shadow-sm: 0 1px 2px 0 rgba(20,20,18,0.05);
  --shadow: 0 1px 3px 0 rgba(20,20,18,0.08), 0 1px 2px -1px rgba(20,20,18,0.06);
  --shadow-md: 0 4px 12px -2px rgba(20,20,18,0.10), 0 2px 6px -2px rgba(20,20,18,0.06);

  /* legacy aliases: keep .neuron-* classes and server fragments working */
  --canvas: var(--background);
  --surface: var(--card);
  --surface-hover: var(--subtle);
  --divider: var(--border);
  --divider-strong: var(--input);
  --ink: var(--foreground);
  --ink-secondary: #52525b;
  --ink-muted: var(--muted-foreground);
  --accent: var(--primary);
  --accent-strong: var(--primary-hover);
  --on-accent: var(--primary-foreground);
  --danger: var(--destructive);
  --radius-sm: calc(var(--radius) - 0.25rem);

  margin: 0;
  padding: 1.75rem;
  background: var(--background);
  color: var(--foreground);
  font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}

body.neuron-view.theme-dark {
  --background: #0e1417;
  --foreground: #e7eaeb;
  --card: #161d21;
  --card-foreground: #e7eaeb;
  --primary: #5aa583;
  --primary-foreground: #0b1114;
  --primary-hover: #6bb593;
  --secondary: #1e262b;
  --secondary-foreground: #d5d9db;
  --muted: #1e262b;
  --muted-foreground: #8a959b;
  --subtle: #232c31;
  --border: #262f35;
  --input: #323c43;
  --ring: #5aa583;
  --destructive: #e05a4d;
  --destructive-foreground: #0b1114;
  --ink-secondary: #b6bdc2;
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.30);
  --shadow: 0 1px 3px 0 rgba(0,0,0,0.35), 0 1px 2px -1px rgba(0,0,0,0.30);
  --shadow-md: 0 4px 12px -2px rgba(0,0,0,0.45), 0 2px 6px -2px rgba(0,0,0,0.35);
}

/* Keep authored content readable on very wide tabs. */
.neuron-view > * { max-width: 1120px; margin-inline: auto; }

/* --- Base typography ------------------------------------------------------ */
.neuron-view h1 { font-size: 1.6rem; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 0.35rem; }
.neuron-view h2 { font-size: 1.15rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.6rem; }
.neuron-view h3 { font-size: 0.95rem; font-weight: 600; margin: 0 0 0.4rem; }
.neuron-view p { margin: 0.5rem 0; color: var(--ink-secondary); }
.neuron-view a { color: var(--primary-hover); text-decoration: none; font-weight: 500; }
.neuron-view a:hover { text-decoration: underline; }
.neuron-view strong { color: var(--foreground); font-weight: 600; }
.neuron-view small, .neuron-view .muted { color: var(--muted-foreground); font-size: 0.8rem; }
.neuron-view code {
  font-family: ui-monospace, "SF Mono", monospace; font-size: 0.85em;
  background: var(--muted); padding: 0.1rem 0.35rem; border-radius: 5px;
}
.neuron-view hr, .neuron-view .separator { border: 0; border-top: 1px solid var(--border); margin: 1.25rem 0; height: 0; }
.neuron-view ::selection { background: color-mix(in srgb, var(--primary) 25%, transparent); }

/* --- Layout --------------------------------------------------------------- */
.neuron-view header { margin-bottom: 1.5rem; }
.neuron-stack, .neuron-view .stack { display: flex; flex-direction: column; gap: 0.75rem; }
.neuron-toolbar, .neuron-view .toolbar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.neuron-view .row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.neuron-grid, .neuron-view .grid { display: grid; gap: 1rem; grid-template-columns: 1fr; margin: 1rem 0; }
@media (min-width: 640px) {
  .neuron-grid.cols-2, .neuron-view .grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .neuron-grid.cols-3, .neuron-view .grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .neuron-grid.cols-4, .neuron-view .grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
}

/* --- Card ----------------------------------------------------------------- */
/* Shared frame: explicit .card, legacy .neuron-card, and bare section/article. */
.neuron-view .card,
.neuron-card,
.neuron-view section:not(.grid):not(.stack):not(.toolbar):not(.row),
.neuron-view article {
  background: var(--card); color: var(--card-foreground);
  border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}
/* Convenience padding for bare sections and legacy .neuron-card. The structural
   .card leaves padding to .card-header / .card-content (shadcn style). */
.neuron-card,
.neuron-view section:not(.grid):not(.stack):not(.toolbar):not(.row),
.neuron-view article { padding: 1.15rem 1.25rem; }
.neuron-view section > :first-child, .neuron-view article > :first-child, .neuron-card > :first-child { margin-top: 0; }
.neuron-view section > :last-child, .neuron-view article > :last-child, .neuron-card > :last-child { margin-bottom: 0; }
.neuron-view section + section, .neuron-view article + article,
.neuron-view .card + .card, .neuron-card + .neuron-card { margin-top: 1rem; }

.neuron-view .card-header { padding: 1.2rem 1.25rem 0; display: flex; flex-direction: column; gap: 0.25rem; }
.neuron-view .card-content { padding: 1.2rem 1.25rem; }
.neuron-view .card-header + .card-content { padding-top: 0.9rem; }
.neuron-view .card-footer { padding: 0 1.25rem 1.2rem; display: flex; align-items: center; gap: 0.5rem; }
.neuron-view .card-title { font-size: 1rem; font-weight: 600; letter-spacing: -0.01em; color: var(--card-foreground); }
.neuron-view .card-description { font-size: 0.82rem; color: var(--muted-foreground); margin: 0; }

/* --- Button --------------------------------------------------------------- */
.neuron-view .btn, .neuron-button, .neuron-view button {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  height: 2.25rem; padding: 0 1rem; border-radius: var(--radius-sm);
  font: inherit; font-size: 0.85rem; font-weight: 500; line-height: 1; white-space: nowrap;
  border: 1px solid transparent; cursor: pointer; user-select: none;
  background: var(--primary); color: var(--primary-foreground);
  transition: background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, transform 0.05s ease;
}
.neuron-view .btn:hover, .neuron-button:hover, .neuron-view button:hover { background: var(--primary-hover); }
.neuron-view .btn:active, .neuron-button:active, .neuron-view button:active { transform: translateY(1px); }
.neuron-view .btn:focus-visible, .neuron-button:focus-visible, .neuron-view button:focus-visible {
  outline: none; box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--ring);
}
.neuron-view .btn:disabled, .neuron-view button:disabled { opacity: 0.5; pointer-events: none; }
/* Variants (scoped so they outrank the bare-button base) */
.neuron-view .btn-secondary, .neuron-view button.secondary, .neuron-button.secondary { background: var(--secondary); color: var(--secondary-foreground); }
.neuron-view .btn-secondary:hover, .neuron-view button.secondary:hover, .neuron-button.secondary:hover { background: var(--subtle); }
.neuron-view .btn-outline, .neuron-view button.outline { background: transparent; color: var(--foreground); border-color: var(--input); }
.neuron-view .btn-outline:hover, .neuron-view button.outline:hover { background: var(--subtle); }
.neuron-view .btn-ghost, .neuron-view button.ghost { background: transparent; color: var(--foreground); }
.neuron-view .btn-ghost:hover, .neuron-view button.ghost:hover { background: var(--subtle); }
.neuron-view .btn-destructive, .neuron-view button.destructive { background: var(--destructive); color: var(--destructive-foreground); }
/* Sizes */
.neuron-view .btn-sm { height: 2rem; padding: 0 0.75rem; font-size: 0.8rem; }
.neuron-view .btn-lg { height: 2.5rem; padding: 0 1.25rem; }
.neuron-view .btn-icon { width: 2.25rem; height: 2.25rem; padding: 0; }

/* --- Form fields ---------------------------------------------------------- */
.neuron-view .input, .neuron-input,
.neuron-view input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),
.neuron-view select, .neuron-view textarea {
  width: 100%; box-sizing: border-box; height: 2.25rem;
  background: var(--card); color: var(--foreground);
  border: 1px solid var(--input); border-radius: var(--radius-sm);
  padding: 0 0.7rem; font: inherit; font-size: 0.85rem;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.neuron-view textarea { height: auto; min-height: 4rem; padding: 0.5rem 0.7rem; }
.neuron-view input:focus, .neuron-view select:focus, .neuron-view textarea:focus, .neuron-input:focus, .neuron-view .input:focus {
  outline: none; border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 22%, transparent);
}
.neuron-view input::placeholder, .neuron-view textarea::placeholder { color: var(--muted-foreground); }
.neuron-view label, .neuron-view .label { display: block; font-size: 0.8rem; font-weight: 500; color: var(--foreground); margin-bottom: 0.4rem; }
.neuron-view button[type=submit] { width: auto; }

/* --- Badge ---------------------------------------------------------------- */
.neuron-view .badge, .neuron-badge {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.72rem; font-weight: 500; line-height: 1.2;
  padding: 0.18rem 0.55rem; border-radius: 999px;
  border: 1px solid transparent; background: var(--secondary); color: var(--secondary-foreground);
}
.neuron-view .badge-primary { background: color-mix(in srgb, var(--primary) 15%, var(--card)); color: var(--primary-hover); border-color: color-mix(in srgb, var(--primary) 30%, transparent); }
.neuron-view .badge-outline { background: transparent; color: var(--foreground); border-color: var(--border); }
.neuron-view .badge-destructive { background: color-mix(in srgb, var(--destructive) 14%, var(--card)); color: var(--destructive); border-color: color-mix(in srgb, var(--destructive) 30%, transparent); }

/* --- Kbd (keyboard hint) -------------------------------------------------- */
.neuron-view kbd, .neuron-view .kbd, .neuron-kbd {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem;
  min-width: 1.3rem; height: 1.3rem; padding: 0 0.4rem;
  font-family: inherit; font-size: 0.72rem; font-weight: 500; line-height: 1;
  color: var(--muted-foreground); background: var(--subtle);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  user-select: none;
}

/* --- Table ---------------------------------------------------------------- */
.neuron-view table, .neuron-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.neuron-view th, .neuron-table th {
  text-align: left; font-weight: 500; color: var(--muted-foreground);
  padding: 0.55rem 0.6rem; border-bottom: 1px solid var(--border);
}
.neuron-view td, .neuron-table td { padding: 0.55rem 0.6rem; border-bottom: 1px solid var(--border); color: var(--ink-secondary); }
.neuron-view tbody tr:last-child td, .neuron-table tr:last-child td { border-bottom: none; }
.neuron-view tbody tr:hover td { background: var(--subtle); }
/* Wide content (tables) scrolls inside its own box instead of the page. */
.neuron-scroll { overflow-x: auto; }

/* --- Metric / stat -------------------------------------------------------- */
.neuron-view .metric, .neuron-metric { font-size: 2rem; font-weight: 650; letter-spacing: -0.03em; color: var(--foreground); }
.neuron-view .metric-label, .neuron-metric-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); }

/* --- List (server fragments) ---------------------------------------------- */
.neuron-list { list-style: none; margin: 0.5rem 0 0; padding: 0; }
.neuron-list-row { display: flex; gap: 0.75rem; align-items: baseline; padding: 0.45rem 0.25rem; border-bottom: 1px solid var(--border); font-size: 0.85rem; flex-wrap: wrap; }
.neuron-list-row:last-child { border-bottom: none; }
.neuron-file-name { font-weight: 500; color: var(--foreground); }
.neuron-file-path { margin-left: auto; font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--muted-foreground); }
.neuron-snippet { flex-basis: 100%; color: var(--ink-secondary); font-size: 0.8rem; }

/* --- Alert / empty -------------------------------------------------------- */
.neuron-alert, .neuron-view .alert { background: color-mix(in srgb, var(--destructive) 10%, var(--card)); border: 1px solid color-mix(in srgb, var(--destructive) 35%, transparent); color: var(--foreground); border-radius: var(--radius-sm); padding: 0.6rem 0.9rem; font-size: 0.85rem; margin: 0.5rem 0; }
.neuron-empty, .neuron-view .empty { color: var(--muted-foreground); font-size: 0.85rem; padding: 0.75rem 0.25rem; }

.htmx-indicator { opacity: 0; transition: opacity 150ms ease-in; }
.htmx-request .htmx-indicator, .htmx-request.htmx-indicator { opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  .neuron-view *, .neuron-view *::before, .neuron-view *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`;
