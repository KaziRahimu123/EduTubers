// EduTubers logo — serif "E" with a gold 4-point star, navy on cream/white
export default function EduTubersLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="EduTubers logo"
    >
      {/* Background circle — matches the cream background in the logo */}
      <circle cx="50" cy="50" r="50" fill="#F5F0E8" />

      {/* Serif E — navy, drawn as a path */}
      <path
        d="M24 18 H76 V30 H38 V44 H70 V56 H38 V70 H76 V82 H24 Z"
        fill="#1B2B4B"
      />

      {/* 4-point gold star centred at ~(58, 58) — nestled in the counter of the E */}
      <path
        d="M58 44 L61.2 54.8 L72 58 L61.2 61.2 L58 72 L54.8 61.2 L44 58 L54.8 54.8 Z"
        fill="#B8922A"
      />
    </svg>
  );
}

// Logotype: icon + "EduTubers" wordmark
export function EduTubersWordmark({ iconSize = 28, className = '' }: { iconSize?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <EduTubersLogo size={iconSize} />
      <span className="font-extrabold tracking-tight text-gray-900 dark:text-white">
        EduTubers
      </span>
    </span>
  );
}
