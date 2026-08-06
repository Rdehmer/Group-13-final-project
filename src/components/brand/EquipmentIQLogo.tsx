import Image from "next/image";

export const BRAND_MARK_SRC = "/brand/equipmentiq-mark.png";
export const BRAND_LOGO_SRC = "/brand/equipmentiq-logo.png";

type MarkProps = {
  className?: string;
};

/** Icon only — gear, wrench, and IQ circuit (transparent PNG). */
export function EquipmentIQMark({ className = "h-10 w-10", pop = false }: MarkProps & { pop?: boolean }) {
  return (
    <Image
      src={BRAND_MARK_SRC}
      alt=""
      width={500}
      height={500}
      className={`${className} object-contain ${pop ? "brand-logo-mark" : ""}`}
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
    <span className={`whitespace-nowrap font-display font-bold tracking-[-0.02em] ${className}`}>
      <span className={onDark ? "text-white" : "text-slate-700"}>Equipment</span>
      <span className={onDark ? "text-teal-300" : "text-teal-600"}>IQ</span>
    </span>
  );
}

type Variant = "header" | "hero" | "auth" | "splash" | "footer";

type Props = {
  variant?: Variant;
  className?: string;
  /** Use mark + light wordmark on dark backgrounds; full logo image on light backgrounds. */
  onDark?: boolean;
};

const VARIANTS: Record<
  Variant,
  {
    full: string;
    mark: string;
    text: string;
    gap: string;
    wordmarkPull: string;
    fullWidth: number;
    fullHeight: number;
  }
> = {
  header: {
    full: "h-10 w-auto sm:h-11",
    mark: "h-10 w-10 sm:h-11 sm:w-11",
    text: "text-xl sm:text-2xl",
    gap: "gap-1.5",
    wordmarkPull: "-ml-1",
    fullWidth: 240,
    fullHeight: 50,
  },
  hero: {
    full: "h-20 w-auto sm:h-24 lg:h-28",
    mark: "h-16 w-16 sm:h-20 sm:w-20 lg:h-24 lg:w-24",
    text: "text-4xl sm:text-5xl lg:text-6xl",
    gap: "gap-2 sm:gap-2.5",
    wordmarkPull: "-ml-1.5 sm:-ml-2 lg:-ml-2.5",
    fullWidth: 480,
    fullHeight: 100,
  },
  auth: {
    full: "h-12 w-auto sm:h-14",
    mark: "h-11 w-11 sm:h-12 sm:w-12",
    text: "text-xl sm:text-2xl",
    gap: "gap-1.5",
    wordmarkPull: "-ml-1 sm:-ml-1.5",
    fullWidth: 280,
    fullHeight: 58,
  },
  splash: {
    full: "h-16 w-auto sm:h-20",
    mark: "h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16",
    text: "text-xl sm:text-2xl md:text-3xl",
    gap: "gap-1",
    wordmarkPull: "-ml-2 sm:-ml-2.5",
    fullWidth: 340,
    fullHeight: 72,
  },
  footer: {
    full: "h-8 w-auto",
    mark: "h-8 w-8",
    text: "text-lg",
    gap: "gap-1",
    wordmarkPull: "-ml-0.5",
    fullWidth: 180,
    fullHeight: 36,
  },
};

function LogoLockup({
  styles,
  onDark,
  hero,
  className,
  pop,
}: {
  styles: (typeof VARIANTS)[Variant];
  onDark: boolean;
  hero?: boolean;
  className?: string;
  pop: boolean;
}) {
  return (
    <span
      className={`brand-logo-lockup inline-flex flex-nowrap items-center ${styles.gap} ${hero ? "brand-logo-lockup-hero" : ""} ${className ?? ""}`}
      aria-label="EquipmentIQ"
    >
      <EquipmentIQMark
        className={`${styles.mark} shrink-0 ${hero ? "object-left" : ""}`}
        pop={pop}
      />
      <EquipmentIQWordmark
        className={`${styles.text} ${styles.wordmarkPull} shrink-0`}
        onDark={onDark}
      />
    </span>
  );
}

export function EquipmentIQLogo({ variant = "header", className = "", onDark = false }: Props) {
  const styles = VARIANTS[variant];
  const pop = onDark;

  return (
    <LogoLockup
      styles={styles}
      onDark={onDark}
      hero={variant === "hero"}
      className={className}
      pop={pop}
    />
  );
}
