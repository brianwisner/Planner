// The app's mark: a small truss in the brand blue.
export function BrandMark({ small }: { small?: boolean }) {
  const size = small ? 18 : 20
  return <span className="brand-mark" aria-hidden="true">
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 18.5h19" />
      <path d="M4 18.5 8 7.5h8l4 11" />
      <path d="M8 7.5l4 11 4-11" />
    </svg>
  </span>
}
