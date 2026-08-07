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
    <div className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="mb-2 h-1 w-10 rounded-full bg-[#00a3a6]" aria-hidden />
        <h1 className="text-[1.35rem] font-semibold leading-tight tracking-tight text-[#1e2a36] sm:text-[1.5rem] md:text-[1.7rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#5c6b7a] sm:text-[13.5px]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 w-full flex-wrap items-center gap-2 sm:w-auto sm:max-w-[min(100%,28rem)] sm:justify-end">
          {actions}
        </div>
      ) : null}
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
    <label className="form-control grid grid-cols-1 items-start gap-1.5 sm:grid-cols-[8.5rem_1fr] sm:items-center sm:gap-4">
      <span className="label-text text-[13px] font-semibold text-[#374151]">
        {label}
        {required ? <span className="text-[#d64545]"> *</span> : null}
      </span>
      <div className="w-full min-w-0">{children}</div>
    </label>
  );
}
