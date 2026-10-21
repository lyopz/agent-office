import { BrainCircuit } from 'lucide-react';

// The Brain application mark and the retained compact legacy symbol. The shared brain
// lockup uses a cool, luminous blue to match the live connectome workspace.

export const LOGO_COLORS = { ink: '#050a08', signal: '#39ff88', data: '#4cc9ff' } as const;

/** The full mark (64×64 grid). Use `simple` below ~24 px: it drops the thin lines. */
export function LogoMark({ size = 24, simple = false, title }: { size?: number; simple?: boolean; title?: string }) {
  const { ink, signal, data } = LOGO_COLORS;
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" focusable="false" {...a11y} style={{ display: 'block', flex: 'none' }}>
      <rect x="2.5" y="2.5" width="59" height="59" rx="16" fill={ink} stroke={signal} strokeWidth={simple ? 4 : 3} />
      {!simple && <path d="M32 13v7" stroke={signal} strokeWidth="3" strokeLinecap="round" />}
      <circle cx="32" cy={simple ? 14 : 11.5} r={simple ? 5 : 4} fill={data} />
      <rect x="9" y="31" width="7" height="13" rx="3.5" fill={signal} />
      <rect x="48" y="31" width="7" height="13" rx="3.5" fill={signal} />
      <rect x="14" y="19" width="36" height="35" rx="11" fill={signal} />
      <rect x="18" y="26" width="28" height="14" rx="7" fill={ink} />
      {!simple && <path d="M25 33h14" stroke={data} strokeWidth="1.6" />}
      <circle cx="25" cy="33" r={simple ? 3.6 : 3.2} fill={data} />
      <circle cx="39" cy="33" r={simple ? 3.6 : 3.2} fill={data} />
      {!simple && <circle cx="32" cy="33" r="1.6" fill={data} />}
      {!simple && <path d="M25 46h4l3 3 3-3h4" stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {!simple && <circle cx="23.5" cy="46" r="2.2" fill={ink} />}
      {!simple && <circle cx="40.5" cy="46" r="2.2" fill={ink} />}
    </svg>
  );
}

/** Brain mark and name, sized for the 44 px top bar. The words hide on small screens. */
export function LogoLockup({ size = 26 }: { size?: number }) {
  return (
    <span className="logo-lockup" aria-label="The Brain" role="img">
      <BrainCircuit size={size} strokeWidth={1.8} color="#9beaff" style={{ filter: 'drop-shadow(0 0 7px rgba(83,210,255,.48))' }} aria-hidden="true" />
      <span className="logo-words hide-sm" aria-hidden="true">
        <span className="logo-line1">THE</span>
        <span className="logo-line2">BRAIN</span>
      </span>
    </span>
  );
}

