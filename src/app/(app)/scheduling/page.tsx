import { redirect } from "next/navigation";

/**
 * Team Schedule / availability board was removed as duplicate of Technician Schedule.
 * Keep this route so old bookmarks and deeplinks do not 404 — send everyone to jobs calendar.
 */
export default function SchedulingRedirectPage() {
  redirect("/technician");
}
