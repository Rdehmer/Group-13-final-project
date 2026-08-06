import Image from "next/image";

export const BRAND_MARK_SRC = "/brand/equipmentiq-mark.png";
export const BRAND_LOGO_SRC = "/brand/equipmentiq-logo.png";

type MarkProps = {
  className?: string;
};

/** Icon only — gear, wrench, and IQ circuit (transparent PNG). */
export function EquipmentIQMark({ className = "h-10 w-10" }: MarkProps) {
  return (
    <Image
      src={BRAND_MARK_SRC}
      alt=""
      width={500}
      height={500}
      className={`${className} object-contain`}
      aria-hidden
    />
  );
}

type WordmarkProps = {
  className?: string;
  onDark?: boolean;
};

/** Text lockup when the full logo image is not used (e.g. on dark backgrounds). */
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
  /** Use mark + light wordmark on dark backgrounds; full logo image on light backgrounds. */
  onDark?: boolean;
};

const VARIANTS: Record<
  Variant,
  { full: string; mark: string; text: string; gap: string; fullWidth: number; fullHeight: number }
> = {
  header: {
    full: "h-9 w-auto sm:h-10",
    mark: "h-9 w-9 sm:h-10 sm:w-10",
    text: "text-xl sm:text-2xl",
    gap: "gap-2.5",
    fullWidth: 220,
    fullHeight: 46,
  },
  hero: {
    full: "h-16 w-auto sm:h-20 lg:h-24",
    mark: "h-14 w-14 sm:h-16 sm:w-16 lg:h-20 lg:w-20",
    text: "text-3xl sm:text-4xl lg:text-5xl",
    gap: "gap-4",
    fullWidth: 420,
    fullHeight: 88,
  },
  auth: {
    full: "h-12 w-auto sm:h-14",
    mark: "h-12 w-12 sm:h-14 sm:w-14",
    text: "text-2xl sm:text-3xl",
    gap: "gap-3",
    fullWidth: 280,
    fullHeight: 58,
  },
  footer: {
    full: "h-8 w-auto",
    mark: "h-8 w-8",
    text: "text-lg",
    gap: "gap-2",
    fullWidth: 180,
    fullHeight: 36,
  },
};

export function EquipmentIQLogo({ variant = "header", className = "", onDark = false }: Props) {
  const styles = VARIANTS[variant];

  if (onDark) {
    return (
      <span
        className={`inline-flex items-center ${styles.gap} ${className}`}
        aria-label="EquipmentIQ"
      >
        <EquipmentIQMark className={styles.mark} />
        <EquipmentIQWordmark className={styles.text} onDark />
      </span>
    );
  }

  return (
    <Image
      src={BRAND_LOGO_SRC}
      alt="EquipmentIQ"
      width={styles.fullWidth}
      height={styles.fullHeight}
      className={`${styles.full} object-contain object-left ${className}`}
      priority={variant === "hero"}
    />
  );
}
