"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Mail, Menu, PanelLeftClose, PanelLeftOpen, Wrench } from "lucide-react";
import { useCustomerRatingGate } from "@/contexts/CustomerRatingGateContext";
import { type NavItem } from "@/lib/roles";
import { filterNavForProfile } from "@/lib/employeePermissions";
import { ROLE_LABELS, type Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { DemoPersonaSwitcher } from "@/components/DemoPersonaSwitcher";
import { fetchManagerUnreadInboxCount, MANAGER_INBOX_UNREAD_EVENT } from "@/lib/manager-inbox";

const CUSTOMER_HOME = "/customer";
const UNREAD_POLL_MS = 30_000;
const MANAGER_SIDEBAR_COLLAPSED_KEY = "esm-manager-sidebar-collapsed";

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
  if (item.href === "/timesheets" && role === "technician") return "My Timesheet";
  return item.label;
}

function labeledNavItem(item: NavItem, role: Profile["role"]): NavItem {
  const label = item.section ? item.label : navLabel(item, role);
  const children = item.children?.map((child) => labeledNavItem(child, role));
  if (label === item.label && !children) return item;
  return { ...item, label, ...(children ? { children } : {}) };
}

function closeMobileDrawer() {
  const toggle = document.getElementById("app-drawer") as HTMLInputElement | null;
  if (toggle) toggle.checked = false;
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
  const router = useRouter();
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
    <Link
      href={item.href}
      className={gatedNavClassName(false, active, className)}
      onClick={(event) => {
        // DaisyUI drawer overlay can swallow default Link navigation on some viewports.
        event.preventDefault();
        closeMobileDrawer();
        router.push(item.href);
      }}
    >
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

function NavSection({
  item,
  pathname,
  isGateActive,
  blockNavigation,
  unreadInbox,
  allNavItems,
}: {
  item: NavItem;
  pathname: string;
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
  unreadInbox: number;
  allNavItems: NavItem[];
}) {
  return (
    <>
      <li className="menu-title mt-2 px-3 pt-2 first:mt-0">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">
          {item.label}
        </span>
      </li>
      {(item.children ?? []).map((child) => {
        if (child.children?.length && !child.section) {
          return (
            <NavDetailsGroup
              key={child.href}
              item={child}
              pathname={pathname}
              isGateActive={isGateActive}
              blockNavigation={blockNavigation}
            />
          );
        }
        const flatLeaves = allNavItems.flatMap((n) => collectLeafHrefs(n));
        const matches = flatLeaves.filter(
          (href) => pathname === href || pathname.startsWith(`${href}/`),
        );
        const best = [...matches].sort((a, b) => b.length - a.length)[0];
        const active = best === child.href;
        const showBadge = child.href === "/inbox" && unreadInbox > 0;
        return (
          <li key={child.href}>
            <GatedNavLink
              item={{
                ...child,
                label: showBadge ? `${child.label} (${unreadInbox})` : child.label,
              }}
              pathname={pathname}
              className={
                active
                  ? "active border-l-2 border-primary bg-primary/10 font-semibold text-primary"
                  : "border-l-2 border-transparent opacity-80 hover:bg-base-200/80 hover:opacity-100"
              }
              isGateActive={isGateActive}
              blockNavigation={blockNavigation}
            />
          </li>
        );
      })}
    </>
  );
}

function collectLeafHrefs(item: NavItem): string[] {
  if (item.section) {
    return (item.children ?? []).flatMap(collectLeafHrefs);
  }
  if (item.children?.length) {
    return [item.href, ...item.children.flatMap(collectLeafHrefs)];
  }
  return item.href.startsWith("#") ? [] : [item.href];
}

function SidebarNav({
  profileEmail,
  pathname,
  navItems,
  isGateActive,
  blockNavigation,
  unreadInbox,
}: {
  profileEmail: string;
  pathname: string;
  navItems: NavItem[];
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
  unreadInbox: number;
}) {
  return (
    <>
      <div className="mb-3 flex items-center gap-3 rounded-2xl bg-primary/10 px-3 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-content shadow-sm">
          <Wrench className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold leading-tight">ESM</p>
          <p className="truncate text-[11px] opacity-55">Field service</p>
        </div>
        <DemoPersonaSwitcher currentEmail={profileEmail} />
      </div>
      <ul className="menu w-full gap-0.5 bg-transparent p-0 text-base-content">
        {navItems.map((item) => {
          if (item.section && item.children?.length) {
            return (
              <NavSection
                key={item.href}
                item={item}
                pathname={pathname}
                isGateActive={isGateActive}
                blockNavigation={blockNavigation}
                unreadInbox={unreadInbox}
                allNavItems={navItems}
              />
            );
          }

          if (item.children?.length) {
            return (
              <NavDetailsGroup
                key={item.href}
                item={item}
                pathname={pathname}
                isGateActive={isGateActive}
                blockNavigation={blockNavigation}
              />
            );
          }

          const flatLeaves = navItems.flatMap((n) => collectLeafHrefs(n));
          const matches = flatLeaves.filter(
            (href) => pathname === href || pathname.startsWith(`${href}/`),
          );
          const best = [...matches].sort((a, b) => b.length - a.length)[0];
          const active = best === item.href;
          const showBadge = item.href === "/inbox" && unreadInbox > 0;
          return (
            <li key={item.href}>
              <GatedNavLink
                item={{
                  ...item,
                  label: showBadge ? `${item.label} (${unreadInbox})` : item.label,
                }}
                pathname={pathname}
                className={
                  active
                    ? "active border-l-2 border-primary bg-primary/10 font-semibold text-primary"
                    : "border-l-2 border-transparent opacity-80 hover:bg-base-200/80 hover:opacity-100"
                }
                isGateActive={isGateActive}
                blockNavigation={blockNavigation}
              />
            </li>
          );
        })}
      </ul>
    </>
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
  const [unreadInbox, setUnreadInbox] = useState(0);
  const navItems = filterNavForProfile(profile).map((item) => labeledNavItem(item, profile.role));
  const showManagerInbox = profile.role === "service_manager";
  /** Desktop sidebar collapse is only for the manager shell. */
  const canCollapseSidebar = profile.role === "service_manager";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const refreshUnread = useCallback(async () => {
    if (profile.role !== "service_manager") {
      setUnreadInbox(0);
      return;
    }
    try {
      const supabase = createClient();
      const count = await fetchManagerUnreadInboxCount(supabase);
      setUnreadInbox(count);
    } catch {
      /* keep last known count */
    }
  }, [profile.role]);

  useEffect(() => {
    setMounted(true);
    if (profile.role !== "service_manager") return;
    try {
      setSidebarCollapsed(localStorage.getItem(MANAGER_SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, [profile.role]);

  useEffect(() => {
    if (!canCollapseSidebar) return;
    try {
      localStorage.setItem(MANAGER_SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [canCollapseSidebar, sidebarCollapsed]);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((v) => !v);
  }

  useEffect(() => {
    if (!showManagerInbox) return;
    void refreshUnread();
    const onUnreadChanged = () => void refreshUnread();
    window.addEventListener(MANAGER_INBOX_UNREAD_EVENT, onUnreadChanged);
    const id = window.setInterval(() => void refreshUnread(), UNREAD_POLL_MS);
    return () => {
      window.removeEventListener(MANAGER_INBOX_UNREAD_EVENT, onUnreadChanged);
      window.clearInterval(id);
    };
  }, [showManagerInbox, refreshUnread, pathname]);

  const gateActive = mounted && isGateActive;

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const inboxButton = showManagerInbox ? (
    <Link
      href="/inbox"
      className={`btn btn-ghost btn-sm relative gap-1 ${
        pathname === "/inbox" || pathname.startsWith("/inbox/") ? "btn-active" : ""
      }`}
      aria-label={
        unreadInbox > 0 ? `Inbox, ${unreadInbox} unread` : "Inbox"
      }
      title="Inbox"
    >
      <Mail className="h-4 w-4" />
      <span className="hidden sm:inline">Inbox</span>
      {unreadInbox > 0 ? (
        <span className="badge badge-error badge-sm absolute -right-1 -top-1 min-w-5 justify-center px-1">
          {unreadInbox > 99 ? "99+" : unreadInbox}
        </span>
      ) : null}
    </Link>
  ) : null;

  const sidebarProps = {
    profileEmail: profile.email,
    pathname,
    navItems,
    isGateActive: gateActive,
    blockNavigation,
    unreadInbox,
  };

  const desktopSidebarHidden = canCollapseSidebar && sidebarCollapsed;

  return (
    <div className="min-h-screen bg-base-200 lg:flex">
      {/* Desktop sidebar — managers can collapse for max page width */}
      {!desktopSidebarHidden ? (
        <aside
          className="app-sidebar-scroll hidden shrink-0 border-r border-base-300/70 bg-base-100 lg:block"
          style={{
            position: "sticky",
            top: 0,
            alignSelf: "flex-start",
            width: "18rem",
            height: "100dvh",
            maxHeight: "100dvh",
            overflowY: "auto",
            overscrollBehavior: "contain",
            scrollbarGutter: "stable",
          }}
        >
          <div className="p-4">
            {canCollapseSidebar ? (
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm gap-1"
                  onClick={toggleSidebarCollapsed}
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose className="h-4 w-4" />
                  <span className="text-xs">Hide menu</span>
                </button>
              </div>
            ) : null}
            <SidebarNav {...sidebarProps} />
          </div>
        </aside>
      ) : null}

      {/* Mobile drawer + main column */}
      <div className="drawer min-h-screen min-w-0 flex-1">
        <input id="app-drawer" type="checkbox" className="drawer-toggle" />
        <div className="drawer-content flex min-h-screen flex-col">
          <header className="navbar sticky top-0 z-30 border-b border-base-300/80 bg-base-100/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-base-100/85">
            <div className="flex-none gap-1">
              <label
                htmlFor="app-drawer"
                className="btn btn-ghost btn-square lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </label>
              {canCollapseSidebar && desktopSidebarHidden ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm hidden gap-1 lg:inline-flex"
                  onClick={toggleSidebarCollapsed}
                  aria-label="Expand sidebar"
                  title="Show menu"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                  <span className="text-xs">Menu</span>
                </button>
              ) : null}
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
            <div className="flex items-center gap-2 md:gap-3">
              {inboxButton}
              <div className="hidden items-center gap-3 md:flex">
                <div className="text-right text-sm">
                  <p className="font-medium">{profile.full_name || profile.email}</p>
                  <p className="text-xs opacity-55">{ROLE_LABELS[profile.role]}</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={logout}>
                  <LogOut className="h-4 w-4" /> Logout
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm md:hidden"
                onClick={logout}
                aria-label="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="flex items-center justify-between gap-2 border-b border-base-300/80 bg-base-100 px-4 py-2.5 md:hidden">
            <div className="text-sm">
              <span className="font-medium">{profile.full_name || profile.email}</span>
              <span className="opacity-55"> · {ROLE_LABELS[profile.role]}</span>
            </div>
          </div>

          {gateActive ? (
            <div role="status" className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm">
              Submit your service rating on Home to continue using the portal.
            </div>
          ) : null}

          <main className="app-main flex-1 p-5 md:p-8">{children}</main>
        </div>

        {/* Mobile-only slide-out menu */}
        <aside className="drawer-side z-40 lg:hidden">
          <label htmlFor="app-drawer" className="drawer-overlay" aria-label="Close menu" />
          <div
            className="app-sidebar-scroll relative z-10 w-72 border-r border-base-300/70 bg-base-100 p-4"
            style={{
              height: "100dvh",
              maxHeight: "100dvh",
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}
          >
            <SidebarNav {...sidebarProps} />
          </div>
        </aside>
      </div>
    </div>
  );
}
