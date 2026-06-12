export function Logo({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Background Gradient: Rich, warm charcoal */}
        <linearGradient id="logo-bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e1c19" />
          <stop offset="100%" stopColor="#0f0e0d" />
        </linearGradient>

        {/* Symbol Gradient: Glowing peach/gold to brand terracotta */}
        <linearGradient id="logo-symbol-grad" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffd5a3" />
          <stop offset="40%" stopColor="#db7258" />
          <stop offset="100%" stopColor="#c2593f" />
        </linearGradient>
      </defs>

      {/* Rounded Background */}
      <rect width="32" height="32" rx="8" fill="url(#logo-bg-grad)" />

      {/* Subtle inner border for premium app-icon feel */}
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        fill="none"
        stroke="#f2ede4"
        strokeOpacity="0.08"
      />

      {/* Cursor Line (Caret) */}
      <rect
        x="11.5"
        y="8"
        width="2.5"
        height="16"
        rx="1.25"
        fill="url(#logo-symbol-grad)"
      />

      {/* Spark / Star (Beziers) */}
      <path
        d="M 19.5,6.5 Q 19.5,11.5 24.5,11.5 Q 19.5,11.5 19.5,16.5 Q 19.5,11.5 14.5,11.5 Q 19.5,11.5 19.5,6.5 Z"
        fill="url(#logo-symbol-grad)"
      />
    </svg>
  );
}
