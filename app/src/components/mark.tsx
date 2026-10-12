/** The logo: an E for Earnest, and the dot is the bonus that comes back with a deposit. */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className}>
      <rect width="64" height="64" rx="14" fill="#0b6e4f" />
      <rect x="16" y="16" width="7" height="32" rx="2" fill="#fff" />
      <rect x="16" y="16" width="27" height="7" rx="2" fill="#fff" />
      <rect x="16" y="28.5" width="17" height="7" rx="2" fill="#fff" />
      <rect x="16" y="41" width="27" height="7" rx="2" fill="#fff" />
      <circle cx="43" cy="32" r="4.75" fill="#9fe3c4" />
    </svg>
  );
}
