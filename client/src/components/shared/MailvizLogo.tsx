interface MailvizLogoProps {
  size?: number;
}

export function MailvizLogo({ size = 24 }: MailvizLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Central dot */}
      <circle cx="60" cy="60" r="8" fill="#0f62fe" />
      <circle cx="60" cy="60" r="5" fill="#4589ff" />

      {/* Orbit 1 - Mail (tilted) */}
      <ellipse
        cx="60" cy="60" rx="45" ry="18"
        stroke="#4589ff" strokeWidth="1.5" opacity="0.6"
        transform="rotate(-20, 60, 60)"
      />
      <circle cx="98" cy="48" r="4" fill="#4589ff" />

      {/* Orbit 2 - Calendar (tilted other way) */}
      <ellipse
        cx="60" cy="60" rx="40" ry="16"
        stroke="#08bdba" strokeWidth="1.5" opacity="0.6"
        transform="rotate(40, 60, 60)"
      />
      <circle cx="28" cy="42" r="4" fill="#08bdba" />

      {/* Orbit 3 - Companies */}
      <ellipse
        cx="60" cy="60" rx="35" ry="14"
        stroke="#8a3ffc" strokeWidth="1.5" opacity="0.6"
        transform="rotate(-65, 60, 60)"
      />
      <circle cx="78" cy="90" r="4" fill="#8a3ffc" />

      {/* Inner glow */}
      <circle cx="60" cy="60" r="12" fill="#0f62fe" opacity="0.1" />
    </svg>
  );
}
