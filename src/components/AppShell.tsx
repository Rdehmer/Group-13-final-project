"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, LogOut, Wrench } from "lucide-react";
import { ThemeSelector } from "@/components/ThemeSelector";
import { NAV_ITEMS, type NavItem } from "@/lib/roles";
import { ROLE_LABELS, type Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  pathname,
  className,
}: {
  item: NavItem;
  pathname: string;
  className?: string;
}) {
  const active = item.href === "/customer"
    ? pathname === "/customer"
    : isPathActive(pathname, item.href);

  return (
    <Link href={item.href} className={`${active ? "active font-medium" : ""} ${className ?? ""}`.trim()}>
      {item.label}
    </Link>
  );
}

function NavDetailsGroup({
  item,
  pathname,
  profile,
}: {
  item: NavItem;
  pathname: string;
  profile: Profile;
}) {
  const childActive = item.children!.some((child) =>
    child.href === "/customer"
      ? pathname === "/customer"
      : isPathActive(pathname, child.href),
  );
  const sectionOpen = childActive || isPathActive(pathname, item.href);

  return (
    <li>
      <Link href={item.href} className={sectionOpen ? "font-medium" : ""}>
        {item.label}
      </Link>
      <ul>
        {item.children!
          .filter((child) => child.roles.includes(profile.role))
          .map((child) => (
            <li key={`${child.href}-${child.label}`}>
              <NavLink item={child} pathname={pathname} />
            </li>
          ))}
      </ul>
    </li>
  );
}

export function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = NAV_ITEMS.filter((item) => item.roles.includes(profile.role));

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="drawer lg:drawer-open min-h-screen">
      <input id="app-drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex min-h-screen flex-col">
        <header className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100 px-4 shadow-sm">
          <div className="flex-none lg:hidden">
            <label htmlFor="app-drawer" className="btn btn-ghost btn-square" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </label>
          </div>
          <div className="flex-1">
            <div>
              <p className="text-xs uppercase tracking-wide opacity-60">Equipment Service Manager</p>
              <p className="font-semibold leading-tight">Ridley Equipment Services</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <div className="text-right text-sm">
              <p className="font-medium">{profile.full_name || profile.email}</p>
              <p className="opacity-60">{ROLE_LABELS[profile.role]}</p>
            </div>
            <ThemeSelector compact />
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={logout}>
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </header>

        <div className="flex items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-4 py-2 md:hidden">
          <div className="text-sm">
            <span className="font-medium">{profile.full_name || profile.email}</span>
            <span className="opacity-60"> · {ROLE_LABELS[profile.role]}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSelector compact />
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout} aria-label="Logout">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>

      <aside className="drawer-side z-40">
        <label htmlFor="app-drawer" className="drawer-overlay" aria-label="Close menu" />
        <nav className="menu min-h-full w-72 bg-base-100 p-4 text-base-content">
          <div className="mb-6 flex items-center gap-2 px-2">
            <Wrench className="h-6 w-6 text-primary" />
            <span className="font-bold">ESM</span>
          </div>
          {navItems.map((item) => {
            if (item.children?.length) {
              return (
                <NavDetailsGroup
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  profile={profile}
                />
              );
            }

            const matches = navItems.filter(
              (n) => !n.children && (pathname === n.href || pathname.startsWith(`${n.href}/`)),
            );
            const best = [...matches].sort((a, b) => b.href.length - a.href.length)[0];
            const active = best?.href === item.href;
            return (
              <li key={item.href}>
                <Link href={item.href} className={active ? "active font-medium" : ""}>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
