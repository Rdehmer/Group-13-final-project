export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-[1.65rem] font-semibold leading-tight tracking-tight text-base-content md:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-base-content/60">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function FormRow({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="form-control grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[8.5rem_1fr] sm:gap-4">
      <span className="label-text text-sm font-medium text-base-content/80">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </span>
      <div className="w-full">{children}</div>
    </label>
  );
}
