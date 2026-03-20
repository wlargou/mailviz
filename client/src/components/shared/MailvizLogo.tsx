interface MailvizLogoProps {
  size?: number;
  variant?: 'icon' | 'animated';
}

/**
 * Mailviz "Orbit" logo.
 * - variant="icon": Simplified, bold strokes for header/favicon (small sizes)
 * - variant="animated": Full orbits with CSS rotation animation (login page)
 */
export function MailvizLogo({ size = 24, variant = 'icon' }: MailvizLogoProps) {
  if (variant === 'animated') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="mailviz-logo--animated"
      >
        <defs>
          <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#4589ff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#4589ff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer glow */}
        <circle cx="100" cy="100" r="30" fill="url(#core-glow)" />

        {/* Orbit 1 */}
        <ellipse
          cx="100" cy="100" rx="80" ry="28"
          stroke="#4589ff" strokeWidth="1.2" opacity="0.4"
          transform="rotate(-25, 100, 100)"
          className="mailviz-orbit mailviz-orbit--1"
        />
        <circle cx="172" cy="78" r="5" fill="#4589ff" className="mailviz-satellite mailviz-satellite--1" opacity="0.9" />

        {/* Orbit 2 */}
        <ellipse
          cx="100" cy="100" rx="70" ry="24"
          stroke="#08bdba" strokeWidth="1.2" opacity="0.4"
          transform="rotate(35, 100, 100)"
          className="mailviz-orbit mailviz-orbit--2"
        />
        <circle cx="38" cy="72" r="5" fill="#08bdba" className="mailviz-satellite mailviz-satellite--2" opacity="0.9" />

        {/* Orbit 3 */}
        <ellipse
          cx="100" cy="100" rx="60" ry="20"
          stroke="#8a3ffc" strokeWidth="1.2" opacity="0.4"
          transform="rotate(-70, 100, 100)"
          className="mailviz-orbit mailviz-orbit--3"
        />
        <circle cx="130" cy="155" r="5" fill="#8a3ffc" className="mailviz-satellite mailviz-satellite--3" opacity="0.9" />

        {/* Central core */}
        <circle cx="100" cy="100" r="10" fill="#0f62fe" />
        <circle cx="100" cy="100" r="6" fill="#4589ff" />
        <circle cx="100" cy="100" r="3" fill="#ffffff" opacity="0.6" />
      </svg>
    );
  }

  // Icon variant — simplified, bold, readable at small sizes
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Central dot */}
      <circle cx="16" cy="16" r="3.5" fill="#4589ff" />

      {/* Three orbit arcs (partial, bold) */}
      <path
        d="M4 16 Q16 6, 28 16"
        stroke="#4589ff" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.7"
      />
      <path
        d="M6 24 Q16 14, 26 8"
        stroke="#08bdba" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.7"
      />
      <path
        d="M8 6 Q14 18, 24 26"
        stroke="#8a3ffc" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.7"
      />

      {/* Satellite dots */}
      <circle cx="27" cy="15" r="1.5" fill="#4589ff" />
      <circle cx="7" cy="23" r="1.5" fill="#08bdba" />
      <circle cx="23" cy="25" r="1.5" fill="#8a3ffc" />
    </svg>
  );
}
