"use client";

/**
 * Walmart-style weekly technician availability + published shifts matrix.
 * Techs set preferred hours; managers assign shifts and view the team.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addDays,
  format,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Save,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/ui";
import {
  WEEKDAY_FULL,
  availabilityForDay,
  availabilityWindowsForDay,
  cancelShift,
  cellCaption,
  cellClass,
  cellKind,
  formatAvailabilityClocks,
  formatShiftClock,
  getWeekDays,
  isUsingLocalScheduleStore,
  listAvailability,
  listShifts,
  saveDayAvailability,
  seedDefaultAvailabilityIfEmpty,
  shiftsForCell,
  upsertShift,
  weekRangeLabel,
  type CellKind,
} from "@/lib/techAvailability";
import {
  formatTimeOffLabel,
  timeOffCoversDay,
  type TimeOffRange,
} from "@/lib/time-off";
import type {
  Profile,
  TechnicianAvailability,
  TechnicianShift,
  UserRole,
} from "@/lib/types";

type TechRow = Pick<Profile, "id" | "full_name" | "email" | "role" | "is_active">;

function techName(t: TechRow): string {
  return t.full_name?.trim() || t.email || "Technician";
}

function timeInputVal(t: string): string {
  return String(t).trim().slice(0, 5);
}

export default function SchedulingPage() {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [techs, setTechs] = useState<TechRow[]>([]);
  const [anchor, setAnchor] = useState(() => new Date());
  const [availability, setAvailability] = useState<TechnicianAvailability[]>([]);
  const [shifts, setShifts] = useState<TechnicianShift[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOffRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localMode, setLocalMode] = useState(false);

  // Modal: edit tech's weekly preference for one weekday, or add a shift
  const [editor, setEditor] = useState<
    | null
    | {
        mode: "availability" | "shift";
        technicianId: string;
        date?: string;
        dayOfWeek: number;
        shiftId?: string | null;
      }
  >(null);
  const [form, setForm] = useState({
    start_time: "08:00",
    end_time: "17:00",
    start_time_2: "13:00",
    end_time_2: "17:00",
    has_second_window: false,
    is_available: true,
    note: "",
    status: "published" as "published" | "draft",
  });

  const isManager =
    profile?.role === "administrator" || profile?.role === "service_manager";
  const isTech = profile?.role === "technician";

  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const weekFrom = weekDays[0]?.date ?? "";
  const weekTo = weekDays[6]?.date ?? "";

  const visibleTechs = useMemo(() => {
    if (isTech && profile) return techs.filter((t) => t.id === profile.id);
    return techs;
  }, [techs, isTech, profile]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    const meProfile = me as Profile | null;
    setProfile(meProfile);

    const manager =
      meProfile?.role === "administrator" || meProfile?.role === "service_manager";

    let techList: TechRow[] = [];
    if (manager) {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active")
        .eq("role", "technician")
        .eq("is_active", true)
        .order("full_name");
      techList = (data as TechRow[]) ?? [];
    } else if (meProfile) {
      techList = [
        {
          id: meProfile.id,
          full_name: meProfile.full_name,
          email: meProfile.email,
          role: meProfile.role,
          is_active: meProfile.is_active,
        },
      ];
      await seedDefaultAvailabilityIfEmpty(supabase, meProfile.id);
    }
    setTechs(techList);

    const ids = techList.map((t) => t.id);
    const week = getWeekDays(anchor);
    const from = week[0]!.date;
    const to = week[6]!.date;

    const [availRes, shiftRes, ptoRes] = await Promise.all([
      listAvailability(supabase, ids.length ? ids : undefined),
      listShifts(supabase, { from, to, technicianIds: ids.length ? ids : undefined }),
      supabase
        .from("time_off_requests")
        .select("id, technician_id, start_date, end_date, status, reason")
        .eq("status", "Approved"),
    ]);

    setLocalMode(availRes.local || shiftRes.local || isUsingLocalScheduleStore());
    if (availRes.error) setError(availRes.error);
    else if (shiftRes.error) setError(shiftRes.error);
    setAvailability(availRes.data);
    setShifts(shiftRes.data);
    setTimeOff((ptoRes.data as TimeOffRange[]) ?? []);
    setLoading(false);
  }, [supabase, anchor]);

  useEffect(() => {
    void load();
  }, [load]);

  function openAvailabilityEditor(technicianId: string, dayOfWeek: number, date: string) {
    const windows = availabilityWindowsForDay(availability, technicianId, dayOfWeek);
    const first = windows[0] ?? null;
    const second = windows[1] ?? null;
    setForm({
      start_time: first ? timeInputVal(first.start_time) : "08:00",
      end_time: first ? timeInputVal(first.end_time) : "17:00",
      start_time_2: second ? timeInputVal(second.start_time) : "13:00",
      end_time_2: second ? timeInputVal(second.end_time) : "17:00",
      has_second_window: Boolean(second),
      is_available: first?.is_available ?? dayOfWeek !== 0,
      note: first?.note ?? "",
      status: "published",
    });
    setEditor({ mode: "availability", technicianId, dayOfWeek, date });
  }

  function openShiftEditor(
    technicianId: string,
    date: string,
    dayOfWeek: number,
    existing?: TechnicianShift | null,
  ) {
    const avail = availabilityForDay(availability, technicianId, dayOfWeek);
    setForm({
      start_time: existing
        ? timeInputVal(existing.start_time)
        : avail
          ? timeInputVal(avail.start_time)
          : "08:00",
      end_time: existing
        ? timeInputVal(existing.end_time)
        : avail
          ? timeInputVal(avail.end_time)
          : "17:00",
      start_time_2: "13:00",
      end_time_2: "17:00",
      has_second_window: false,
      is_available: true,
      note: existing?.note ?? "",
      status: (existing?.status as "published" | "draft") || "published",
    });
    setEditor({
      mode: "shift",
      technicianId,
      date,
      dayOfWeek,
      shiftId: existing?.id ?? null,
    });
  }

  async function saveEditor() {
    if (!editor || !profile) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    if (editor.mode === "availability") {
      // Tech can only edit self; manager can edit any
      if (isTech && editor.technicianId !== profile.id) {
        setError("You can only edit your own availability.");
        setBusy(false);
        return;
      }
      const windows = form.is_available
        ? form.has_second_window
          ? [
              { start_time: form.start_time, end_time: form.end_time },
              { start_time: form.start_time_2, end_time: form.end_time_2 },
            ]
          : [{ start_time: form.start_time, end_time: form.end_time }]
        : [{ start_time: form.start_time, end_time: form.end_time }];

      const res = await saveDayAvailability(supabase, {
        technician_id: editor.technicianId,
        day_of_week: editor.dayOfWeek,
        is_available: form.is_available,
        note: form.note || null,
        windows,
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      await logActivity(supabase, {
        userId: profile.id,
        action: "updated",
        recordType: "technician_availability",
        recordId: editor.technicianId,
        newValue: `${WEEKDAY_FULL[editor.dayOfWeek]} ${form.is_available ? "on" : "off"}`,
      });
      setMessage(`Saved ${WEEKDAY_FULL[editor.dayOfWeek]} preference.`);
    } else {
      if (!isManager) {
        setError("Only managers can publish shifts.");
        setBusy(false);
        return;
      }
      const res = await upsertShift(supabase, {
        id: editor.shiftId,
        technician_id: editor.technicianId,
        work_date: editor.date!,
        start_time: form.start_time,
        end_time: form.end_time,
        status: form.status,
        note: form.note || null,
        created_by: profile.id,
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      await logActivity(supabase, {
        userId: profile.id,
        action: editor.shiftId ? "updated" : "created",
        recordType: "technician_shift",
        recordId: res.data?.id ?? editor.date!,
        newValue: `${editor.date} ${form.start_time}-${form.end_time}`,
      });
      setMessage("Shift saved.");
    }

    setEditor(null);
    await load();
    setBusy(false);
  }

  async function removeShift() {
    if (!editor?.shiftId || !isManager) return;
    setBusy(true);
    const { error: err } = await cancelShift(supabase, editor.shiftId);
    if (err) setError(err);
    else {
      setMessage("Shift removed.");
      setEditor(null);
      await load();
    }
    setBusy(false);
  }

  async function applyDefaultWeek() {
    if (!profile || !isTech) return;
    if (!confirm("Reset your weekly preferred hours to Mon–Fri 8–5, Sat 8–12, Sun off?")) return;
    setBusy(true);
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const isSun = day === 0;
      const isSat = day === 6;
      await saveDayAvailability(supabase, {
        technician_id: profile.id,
        day_of_week: day,
        start_time: "08:00",
        end_time: isSat ? "12:00" : "17:00",
        is_available: !isSun,
      });
    }
    setMessage("Weekly template applied.");
    await load();
    setBusy(false);
  }

  function cellContent(
    techId: string,
    day: { date: string; dayOfWeek: number },
  ): { kind: CellKind; line1: string; line2?: string } {
    const onPto = timeOff.some((r) => r.technician_id === techId && timeOffCoversDay(r, day.date));
    const dayShifts = shiftsForCell(shifts, techId, day.date);
    const windows = availabilityWindowsForDay(availability, techId, day.dayOfWeek);
    const avail = windows[0] ?? null;
    const kind = cellKind({
      onPto,
      hasShift: dayShifts.length > 0,
      availability: avail,
    });
    if (kind === "pto") {
      const r = timeOff.find((x) => x.technician_id === techId && timeOffCoversDay(x, day.date));
      return {
        kind,
        line1: "OFF",
        line2: r ? formatTimeOffLabel(r.start_date, r.end_date) : "Approved leave",
      };
    }
    if (kind === "scheduled" && dayShifts[0]) {
      return {
        kind,
        line1: formatShiftClock(dayShifts[0].start_time, dayShifts[0].end_time),
        line2: dayShifts.length > 1 ? `+${dayShifts.length - 1} more` : "Shift",
      };
    }
    if (kind === "available" && windows.length > 0) {
      const clocks = formatAvailabilityClocks(windows);
      if (windows.length > 1) {
        return {
          kind,
          line1: formatShiftClock(windows[0]!.start_time, windows[0]!.end_time),
          line2: formatShiftClock(windows[1]!.start_time, windows[1]!.end_time),
        };
      }
      return {
        kind,
        line1: clocks,
        line2: "Preferred",
      };
    }
    if (kind === "unavailable") {
      return { kind, line1: "N/A", line2: "Not available" };
    }
    return { kind, line1: "—", line2: "Set hours" };
  }

  function onCellClick(techId: string, day: { date: string; dayOfWeek: number }) {
    if (isManager) {
      const existing = shiftsForCell(shifts, techId, day.date)[0] ?? null;
      // Shift+click or hold alternate: for simplicity manager opens shift; double option via form toggle
      openShiftEditor(techId, day.date, day.dayOfWeek, existing);
      return;
    }
    if (isTech && profile?.id === techId) {
      openAvailabilityEditor(techId, day.dayOfWeek, day.date);
    }
  }

  if (loading && !profile) {
    return <p className="p-8 text-center text-sm opacity-50">Loading schedule…</p>;
  }

  if (profile && profile.role === "customer") {
    return (
      <p className="p-8 text-center text-sm opacity-60">This page is for field staff and managers.</p>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isTech ? "My Availability" : "Team schedule"}
        description={
          isTech
            ? "Set when you can work each week — like store associate preferred hours"
            : "Walmart-style week board: preferred availability, published shifts, and time off"
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/time-off" className="btn btn-ghost btn-sm">
              Time off
            </Link>
            <Link href="/technician" className="btn btn-ghost btn-sm">
              {isTech ? "My Day" : "Jobs"}
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1"
              onClick={() => void load()}
              disabled={busy}
            >
              <RefreshCw className={`h-4 w-4 ${busy || loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        }
      />

      {localMode ? (
        <div className="alert alert-warning text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Browser storage mode</p>
            <p className="opacity-80">
              Run{" "}
              <code className="text-xs">
                supabase/migrations/20260806_technician_availability.sql
              </code>{" "}
              so the whole team shares availability and shifts.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {message ? (
        <div className="alert alert-success text-sm">
          <span>{message}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Previous week"
            onClick={() => setAnchor((d) => subDays(startOfWeek(d, { weekStartsOn: 0 }), 7))}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAnchor(new Date())}
          >
            This week
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Next week"
            onClick={() => setAnchor((d) => addDays(startOfWeek(d, { weekStartsOn: 0 }), 7))}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 opacity-50" />
          <p className="font-semibold">{weekRangeLabel(weekDays)}</p>
        </div>
        {isTech ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => void applyDefaultWeek()}
          >
            Apply default week
          </button>
        ) : (
          <p className="text-xs opacity-55">Tap a cell to assign or edit a shift</p>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {(
          [
            ["available", "Available (pref)"],
            ["scheduled", "Scheduled shift"],
            ["pto", "Time off"],
            ["unavailable", "Not available"],
            ["empty", "No preference"],
          ] as [CellKind, string][]
        ).map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-3 w-5 rounded border ${cellClass(k)}`} />
            {label}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="skeleton h-12 w-full rounded-xl" />
          <div className="skeleton h-40 w-full rounded-xl" />
        </div>
      ) : visibleTechs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-base-300 p-10 text-center text-sm opacity-60">
          {isManager
            ? "No active technicians found. Promote users to technician role first."
            : "Profile not loaded."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <table className="table table-sm min-w-[720px]">
            <thead>
              <tr className="bg-base-200/60">
                <th className="sticky left-0 z-10 min-w-[9rem] bg-base-200/95">Associate</th>
                {weekDays.map((d) => (
                  <th key={d.date} className="min-w-[6.5rem] text-center font-semibold">
                    <div>{d.shortLabel}</div>
                    <div className="text-[11px] font-normal opacity-60">
                      {format(parseISO(d.date), "M/d")}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleTechs.map((tech) => (
                <tr key={tech.id}>
                  <td className="sticky left-0 z-10 bg-base-100 font-medium shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                    <div className="leading-tight">{techName(tech)}</div>
                    {!isTech ? (
                      <div className="text-[11px] opacity-45 truncate max-w-[8rem]">{tech.email}</div>
                    ) : null}
                  </td>
                  {weekDays.map((day) => {
                    const cell = cellContent(tech.id, day);
                    const dayShifts = shiftsForCell(shifts, tech.id, day.date);
                    return (
                      <td key={day.date} className="p-1 align-top">
                        <button
                          type="button"
                          onClick={() => onCellClick(tech.id, day)}
                          className={`flex min-h-[4.25rem] w-full flex-col items-center justify-center rounded-lg border px-1 py-1.5 text-center transition hover:ring-2 hover:ring-primary/40 ${cellClass(cell.kind)}`}
                          title={
                            isManager
                              ? "Click to set / edit shift"
                              : "Click to edit preferred hours for this weekday"
                          }
                        >
                          <span className="text-xs font-bold leading-tight">{cell.line1}</span>
                          {cell.line2 ? (
                            <span className="mt-0.5 text-[10px] opacity-70">{cell.line2}</span>
                          ) : null}
                          {dayShifts.length > 1 ? (
                            <span className="badge badge-primary badge-xs mt-1">
                              {dayShifts.length}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isTech ? (
        <p className="text-sm opacity-60">
          Tip: availability is your <strong>preferred weekly pattern</strong> (same days every
          week). Use a second window for split shifts (e.g. morning and evening). Managers
          publish specific shifts on top. Approved{" "}
          <Link href="/time-off" className="link link-primary">
            time off
          </Link>{" "}
          overrides both.
        </p>
      ) : (
        <p className="text-sm opacity-60">
          Green cells = technician preferred hours. Blue = you published a shift. Amber = approved
          leave. Click any cell to assign hours for that day.
        </p>
      )}

      {/* Editor modal */}
      {editor ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-bold">
              {editor.mode === "availability" ? "Preferred hours" : "Work shift"}
            </h3>
            <p className="mt-1 text-sm opacity-65">
              {techName(visibleTechs.find((t) => t.id === editor.technicianId) ?? {
                id: "",
                full_name: null,
                email: "Tech",
                role: "technician" as UserRole,
                is_active: true,
              })}{" "}
              · {WEEKDAY_FULL[editor.dayOfWeek]}
              {editor.date ? ` · ${editor.date}` : ""}
            </p>

            {editor.mode === "availability" ? (
              <label className="mt-4 flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="toggle toggle-success"
                  checked={form.is_available}
                  onChange={(e) => setForm((f) => ({ ...f, is_available: e.target.checked }))}
                />
                <span className="text-sm font-medium">
                  {form.is_available ? "Available this day" : "Not available"}
                </span>
              </label>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-medium">
                  {editor.mode === "availability" ? "Window 1 start" : "Start"}
                </span>
                <input
                  type="time"
                  className="input input-bordered w-full min-h-11"
                  value={form.start_time}
                  disabled={editor.mode === "availability" && !form.is_available}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-medium">
                  {editor.mode === "availability" ? "Window 1 end" : "End"}
                </span>
                <input
                  type="time"
                  className="input input-bordered w-full min-h-11"
                  value={form.end_time}
                  disabled={editor.mode === "availability" && !form.is_available}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                />
              </label>
            </div>

            {editor.mode === "availability" && form.is_available ? (
              <div className="mt-3 space-y-3">
                {!form.has_second_window ? (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm w-full"
                    onClick={() =>
                      setForm((f) => {
                        const fullDay =
                          f.start_time === "08:00" && f.end_time === "17:00";
                        return {
                          ...f,
                          has_second_window: true,
                          end_time: fullDay ? "12:00" : f.end_time,
                          start_time_2: fullDay ? "13:00" : f.start_time_2 || "13:00",
                          end_time_2: fullDay ? "17:00" : f.end_time_2 || "17:00",
                        };
                      })
                    }
                  >
                    Add second window
                  </button>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Window 2 (split shift)</p>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => setForm((f) => ({ ...f, has_second_window: false }))}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-sm font-medium">Start</span>
                        <input
                          type="time"
                          className="input input-bordered w-full min-h-11"
                          value={form.start_time_2}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, start_time_2: e.target.value }))
                          }
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-sm font-medium">End</span>
                        <input
                          type="time"
                          className="input input-bordered w-full min-h-11"
                          value={form.end_time_2}
                          onChange={(e) => setForm((f) => ({ ...f, end_time_2: e.target.value }))}
                        />
                      </label>
                    </div>
                    <p className="text-xs opacity-60">
                      Second window must start at or after the first window ends.
                    </p>
                  </>
                )}
              </div>
            ) : null}

            {editor.mode === "shift" ? (
              <label className="mt-3 flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium">Status</span>
                <select
                  className="select select-bordered w-full min-h-11"
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      status: e.target.value as "published" | "draft",
                    }))
                  }
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
            ) : null}

            <label className="mt-3 flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium">Note</span>
              <input
                className="input input-bordered w-full min-h-11"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Optional"
              />
            </label>

            {isManager && editor.mode === "shift" ? (
              <p className="mt-2 text-xs opacity-50">
                To edit preferred hours instead, close and open from a technician account — or
                switch: use the actions below.
              </p>
            ) : null}

            <div className="modal-action flex-wrap gap-2">
              {isManager && editor.mode === "shift" ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    openAvailabilityEditor(
                      editor.technicianId,
                      editor.dayOfWeek,
                      editor.date ?? weekDays[editor.dayOfWeek]?.date ?? "",
                    )
                  }
                >
                  Edit preference
                </button>
              ) : null}
              {editor.mode === "shift" && editor.shiftId && isManager ? (
                <button
                  type="button"
                  className="btn btn-error btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => void removeShift()}
                >
                  Remove shift
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm gap-1"
                disabled={busy}
                onClick={() => void saveEditor()}
              >
                <Save className="h-4 w-4" />
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setEditor(null)}>
              close
            </button>
          </form>
        </dialog>
      ) : null}

      {/* Mobile-friendly stack list (summary) */}
      <section className="rounded-2xl border border-base-300 bg-base-100 p-4 md:hidden">
        <h2 className="mb-3 font-bold">This week at a glance</h2>
        <ul className="space-y-3">
          {visibleTechs.map((tech) => (
            <li key={tech.id} className="rounded-xl bg-base-200/50 p-3">
              <p className="font-semibold">{techName(tech)}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {weekDays.map((day) => {
                  const cell = cellContent(tech.id, day);
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`rounded-md border px-2 py-1 text-[10px] ${cellClass(cell.kind)}`}
                      onClick={() => onCellClick(tech.id, day)}
                    >
                      <span className="font-bold">{day.shortLabel}</span>
                      <span className="ml-1 opacity-70">{cellCaption(cell.kind)}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
