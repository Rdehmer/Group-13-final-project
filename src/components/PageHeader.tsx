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
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description ? <p className="mt-1 text-sm opacity-70">{description}</p> : null}
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
    <label className="form-control grid grid-cols-1 items-center gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <span className="label-text font-medium">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </span>
      <div className="w-full">{children}</div>
    </label>
  );
}
