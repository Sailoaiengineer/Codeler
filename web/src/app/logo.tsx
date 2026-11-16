// Codeler logo A ("team range"). Same shapes as brand/codeler.svg.
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Codeler">
      <rect width="64" height="64" rx="14" fill="#0f2747" />
      <polygon points="6,50 22,24 34,42" fill="#1d5fa8" />
      <polygon points="30,50 44,22 58,50" fill="#1d5fa8" />
      <polygon points="12,50 32,14 52,50" fill="#2b9bf4" />
      <polygon points="26,25 32,14 38,25 35,23 32,27 29,23" fill="#e8f1ff" />
    </svg>
  )
}
