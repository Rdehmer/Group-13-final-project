type MarkProps = {
  className?: string;
  onDark?: boolean;
};

export function EquipmentIQMark({ className = "h-10 w-10", onDark = false }: MarkProps) {
  const ink = onDark ? "#e2e8f0" : "#334155";
  const teal = onDark ? "#5eead4" : "#14b8a6";

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <defs>
        <clipPath id="equipmentiq-mark-left">
          <rect x="0" y="0" width="35" height="64" />
        </clipPath>
      </defs>

      {/* Left gear with teeth — matches original logo */}
      <g clipPath="url(#equipmentiq-mark-left)">
        <path
          fill={ink}
          fillRule="evenodd"
          d="M31.8 6.5 34.4 10.6l4.9-.9 1.2 5.1 5.1 1.2-.9 4.9 4 3.3-2.6 4.8 3.3 4-4.8 2.6-4 3.3 1.2 5.1-5.1 1.2-.9 4.9-4.9.9-2.8 4.1-5-1.1-1.2-5.1-5.1 1.2-.9-4.9-4-3.3 2.6-4.8-3.3-4 4.8-2.6 4-3.3-1.2-5.1 5.1-1.2.9-4.9 4.9-.9 2.8-4.1 5 1.1 1.2 5.1 5.1-1.2.9 4.9 4 3.3-2.6 4.8 3.3 4-4.8 2.6-4 3.3-1.2-5.1-5.1-1.2.9-4.9 4.9.9 2.8 4.1Zm-.1 10.2a15.3 15.3 0 1 0 .2 30.6 15.3 15.3 0 0 0-.2-30.6Z"
        />
      </g>

      {/* Open-end wrench — vertical, centered */}
      <path
        fill={ink}
        d="M26.2 15.2h3.1l2.6 2.9h2.4l2.6-2.9h3.1v3.5l-3 2.8v17.8c0 1.1.9 2 2 2h.4c1.1 0 2-.9 2-2V21.5l-3-2.8v-3.5H26.2Zm1.8 29.6h7.6v3.4H28v-3.4Z"
      />

      {/* IQ circuit traces — right side */}
      <path d="M40.5 20.5H51.5" stroke={teal} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M51.5 20.5V12" stroke={teal} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="51.5" cy="12" r="2.75" fill={teal} />
      <circle cx="40.5" cy="20.5" r="2.1" fill={teal} />

      <path d="M40.5 32H54.5" stroke={teal} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="54.5" cy="32" r="2.75" fill={teal} />
      <circle cx="40.5" cy="32" r="2.1" fill={teal} />

      <path d="M40.5 43.5H51.5" stroke={teal} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M51.5 43.5V52" stroke={teal} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="51.5" cy="52" r="2.75" fill={teal} />
      <circle cx="40.5" cy="43.5" r="2.1" fill={teal} />
    </svg>
  );
}

type WordmarkProps = {
  className?: string;
  onDark?: boolean;
};

export function EquipmentIQWordmark({ className = "", onDark = false }: WordmarkProps) {
  return (
    <span className={`font-display font-bold tracking-tight ${className}`}>
      <span className={onDark ? "text-white" : "text-slate-700"}>Equipment</span>
      <span className={onDark ? "text-teal-300" : "text-teal-600"}>IQ</span>
    </span>
  );
}

type Variant = "header" | "hero" | "auth" | "footer";

type Props = {
  variant?: Variant;
  className?: string;
  onDark?: boolean;
};

const VARIANTS: Record<Variant, { mark: string; text: string; gap: string }> = {
  header: { mark: "h-9 w-9 sm:h-10 sm:w-10", text: "text-xl sm:text-2xl", gap: "gap-2.5" },
  hero: { mark: "h-14 w-14 sm:h-16 sm:w-16 lg:h-20 lg:w-20", text: "text-3xl sm:text-4xl lg:text-5xl", gap: "gap-4" },
  auth: { mark: "h-12 w-12 sm:h-14 sm:w-14", text: "text-2xl sm:text-3xl", gap: "gap-3" },
  footer: { mark: "h-8 w-8", text: "text-lg", gap: "gap-2" },
};

export function EquipmentIQLogo({ variant = "header", className = "", onDark = false }: Props) {
  const styles = VARIANTS[variant];

  return (
    <span className={`inline-flex items-center ${styles.gap} ${className}`} aria-label="EquipmentIQ">
      <EquipmentIQMark className={styles.mark} onDark={onDark} />
      <EquipmentIQWordmark className={styles.text} onDark={onDark} />
    </span>
  );
}
