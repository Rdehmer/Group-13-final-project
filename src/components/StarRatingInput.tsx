"use client";

import { Star } from "lucide-react";

type Props = {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  required?: boolean;
  disabled?: boolean;
};

export function StarRatingInput({
  id,
  label,
  value,
  onChange,
  required = false,
  disabled = false,
}: Props) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={`${id}-star-1`} className="text-sm font-medium">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </label>
      <div
        className="flex items-center gap-0.5"
        role="radiogroup"
        aria-label={label}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const active = value >= star;
          return (
            <button
              key={star}
              id={star === 1 ? `${id}-star-1` : undefined}
              type="button"
              role="radio"
              aria-checked={value === star}
              className={`btn btn-ghost btn-sm btn-square px-1 ${
                active ? "text-warning" : "opacity-40 hover:opacity-70"
              }`}
              disabled={disabled}
              onClick={() => onChange(star)}
              title={`${star} star${star === 1 ? "" : "s"}`}
            >
              <Star className={`h-5 w-5 ${active ? "fill-current" : ""}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

type DisplayProps = {
  label: string;
  value: number | null;
};

export function StarRatingDisplay({ label, value }: DisplayProps) {
  if (value == null || value <= 0) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="opacity-70">{label}</span>
        <span className="opacity-50">—</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="opacity-70">{label}</span>
      <div className="flex items-center gap-0.5 text-warning" aria-label={`${label}: ${value} out of 5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${value >= star ? "fill-current" : "opacity-30"}`}
          />
        ))}
        <span className="ml-1 tabular-nums text-base-content">{value}</span>
      </div>
    </div>
  );
}
