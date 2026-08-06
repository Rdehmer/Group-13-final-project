import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";

export default async function SplashLayout({ children }: LayoutProps<"/">) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return <div className="min-h-screen">{children}</div>;
}
