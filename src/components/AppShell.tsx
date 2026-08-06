"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, LogOut, Wrench } from "lucide-react";
import { useCustomerRatingGate } from "@/contexts/CustomerRatingGateContext";
import { type NavItem } from "@/lib/roles";
import { filterNavForProfile } from "@/lib/employeePermissions";
import { ROLE_LABELS, type Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { DemoPersonaSwitcher } from "@/components/DemoPersonaSwitcher";

const CUSTOMER_HOME = "/customer";

function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function gatedNavClassName(isBlocked: boolean, active: boolean, className?: string) {
  const parts = [
    active ? "active font-medium" : "",
    isBlocked ? "pointer-events-none cursor-not-allowed opacity-50" : "",
    className ?? "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Role-aware nav labels (same href, clearer names in the field). */
function navLabel(item: NavItem, role: Profile["role"]): string {
  if (item.href === "/technician" && role === "technician") return "My Day";
  if (item.href === "/scheduling" && role === "technician") return "My Availability";
  if (item.href === "/timesheets" && role === "technician") return "My Timesheet";
  return item.label;
}

function labeledNavItem(item: NavItem, role: Profile["role"]): NavItem {
  const label = navLabel(item, role);
  const children = item.children?.map((child) => labeledNavItem(child, role));
  if (label === item.label && !children) return item;
  return { ...item, label, ...(children ? { children } : {}) };
}

function GatedNavLink({
  item,
  pathname,
  className,
  isGateActive,
  blockNavigation,
}: {
  item: NavItem;
  pathname: string;
  className?: string;
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const active = item.href === CUSTOMER_HOME
    ? pathname === CUSTOMER_HOME
    : isPathActive(pathname, item.href);
  const isBlocked = isGateActive && item.href !== CUSTOMER_HOME;

  if (isBlocked) {
    return (
      <span
        role="link"
        aria-disabled="true"
        className={gatedNavClassName(true, active, className)}
        onClick={blockNavigation}
      >
        {item.label}
      </span>
    );
  }

  return (
    <Link href={item.href} className={gatedNavClassName(false, active, className)}>
      {item.label}
    </Link>
  );
}

function NavDetailsGroup({
  item,
  pathname,
  isGateActive,
  blockNavigation,
}: {
  item: NavItem;
  pathname: string;
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const childActive = item.children!.some((child) =>
    child.href === CUSTOMER_HOME
      ? pathname === CUSTOMER_HOME
      : isPathActive(pathname, child.href),
  );
  const sectionOpen = childActive || isPathActive(pathname, item.href);
  const parentBlocked = isGateActive && item.href !== CUSTOMER_HOME;

  return (
    <li>
      {parentBlocked ? (
        <span
          role="link"
          aria-disabled="true"
          className={gatedNavClassName(true, sectionOpen)}
          onClick={blockNavigation}
        >
          {item.label}
        </span>
      ) : (
        <Link href={item.href} className={sectionOpen ? "border-l-2 border-primary/40 font-semibold text-primary" : "border-l-2 border-transparent opacity-80"}>
          {item.label}
        </Link>
      )}
      <ul>
        {item.children!.map((child) => (
          <li key={`${child.href}-${child.label}`}>
            <GatedNavLink
              item={child}
              pathname={pathname}
              isGateActive={isGateActive}
              blockNavigation={blockNavigation}
            />
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
  const { isGateActive, blockNavigation } = useCustomerRatingGate();
  const [mounted, setMounted] = useState(false);
  const navItems = filterNavForProfile(profile).map((item) => labeledNavItem(item, profile.role));

  useEffect(() => {
    setMounted(true);
  }, []);

  const gateActive = mounted && isGateActive;

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="drawer lg:drawer-open min-h-screen bg-base-200">
      <input id="app-drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex min-h-screen flex-col">
        <header className="navbar sticky top-0 z-30 border-b border-base-300/80 bg-base-100/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-base-100/85">
          <div className="flex-none lg:hidden">
            <label htmlFor="app-drawer" className="btn btn-ghost btn-square" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </label>
          </div>
          <div className="flex-1">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-primary/80">
                Equipment Service Manager
              </p>
              <p className="font-display text-base font-semibold leading-tight text-base-content">
                Ridley Equipment Services
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <div className="text-right text-sm">
              <p className="font-medium">{profile.full_name || profile.email}</p>
              <p className="text-xs opacity-55">{ROLE_LABELS[profile.role]}</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={logout}>
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </header>

        <div className="flex items-center justify-between gap-2 border-b border-base-300/80 bg-base-100 px-4 py-2.5 md:hidden">
          <div className="text-sm">
            <span className="font-medium">{profile.full_name || profile.email}</span>
            <span className="opacity-55"> · {ROLE_LABELS[profile.role]}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout} aria-label="Logout">
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {gateActive ? (
          <div role="status" className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm">
            Submit your service rating on Home to continue using the portal.
          </div>
        ) : null}

        <main className="app-main flex-1 p-5 md:p-8">{children}</main>
      </div>

      <aside className="drawer-side z-40">
        <label htmlFor="app-drawer" className="drawer-overlay" aria-label="Close menu" />
        <nav className="menu min-h-full w-72 gap-0.5 border-r border-base-300/70 bg-base-100 p-4 text-base-content">
          <div className="mb-5 flex items-center gap-3 rounded-2xl bg-primary/10 px-3 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-content shadow-sm">
              <Wrench className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold leading-tight">ESM</p>
              <p className="truncate text-[11px] opacity-55">Field service</p>
            </div>
            <DemoPersonaSwitcher currentEmail={profile.email} />
          </div>
          {navItems.map((item) => {
            if (item.children?.length) {
              return (
                <NavDetailsGroup
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  isGateActive={gateActive}
                  blockNavigation={blockNavigation}
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
                <GatedNavLink
                  item={item}
                  pathname={pathname}
                  className={
                    active
                      ? "active border-l-2 border-primary bg-primary/10 font-semibold text-primary"
                      : "border-l-2 border-transparent opacity-80 hover:bg-base-200/80 hover:opacity-100"
                  }
                  isGateActive={gateActive}
                  blockNavigation={blockNavigation}
                />
              </li>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
