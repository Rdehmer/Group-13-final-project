import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { homeForRole } from "@/lib/roles";

export default async function HomePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(homeForRole(profile.role));
}
