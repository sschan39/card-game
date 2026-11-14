/**
 * The card back as a picture, not a pile of CSS boxes.
 *
 * Drawn with a `viewBox`, so it keeps the same 5:7 proportions at any size — the CSS
 * version relied on `aspect-ratio` plus an absolutely positioned inner frame, and the
 * small rows squeezed that frame instead of scaling it.
 */
export function CardBack({ className = '' }: { className?: string }) {
  return <svg
    className={`card-back ${className}`.trim()}
    viewBox="0 0 50 70"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    role="presentation"
  >
    <defs>
      <pattern id="card-back-weave" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="#1a2b22" />
        <rect width="3" height="6" fill="#24382d" />
      </pattern>
    </defs>
    <rect x="0.6" y="0.6" width="48.8" height="68.8" rx="4" fill="url(#card-back-weave)" stroke="#7d6529" strokeWidth="1.2" />
    <rect x="4" y="4" width="42" height="62" rx="2.6" fill="none" stroke="#4a6a56" strokeWidth="1.2" />
  </svg>;
}
