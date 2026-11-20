import icon from '../../../build/icon.json';

const POINTS = icon.branch.map(([x, y]) => `${x},${y}`).join(' ');
const STEP = 360 / icon.branches;

/**
 * The Neuron mark, drawn from build/icon.json -- the one place it is defined --
 * in the current text colour. Like the app icon, the branches span about half
 * of the box, so the box is the size of the plate it sits on.
 */
export default function NeuronMark({ className }: { className?: string }) {
  const box = icon.viewBox;
  return (
    <svg viewBox={`0 0 ${box} ${box}`} className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <g transform={`translate(${box / 2},${box / 2})`}>
        {Array.from({ length: icon.branches }, (_, i) => (
          <polygon key={i} points={POINTS} transform={`rotate(${Math.round(i * STEP)})`} />
        ))}
      </g>
    </svg>
  );
}
