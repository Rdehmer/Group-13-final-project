"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Mail, Menu, Search } from "lucide-react";
import { useCustomerRatingGate } from "@/contexts/CustomerRatingGateContext";
import { type NavItem } from "@/lib/roles";
import { filterNavForProfile } from "@/lib/employeePermissions";
import { topbarConfigForRole, usesStaffInbox, type TopbarConfig } from "@/lib/topbar-config";
import { ROLE_LABELS, type Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { DemoPersonaSwitcher } from "@/components/DemoPersonaSwitcher";
import { EquipmentIQMark } from "@/components/brand/EquipmentIQLogo";
import { countUnreadInboxThreads, CUSTOMER_INBOX_UNREAD_EVENT } from "@/lib/customer-inbox";
import { fetchManagerUnreadInboxCount, MANAGER_INBOX_UNREAD_EVENT } from "@/lib/manager-inbox";

const CUSTOMER_HOME = "/customer";
const CUSTOMER_INBOX = "/customer/inbox";
const MANAGER_INBOX = "/inbox";
const UNREAD_POLL_MS = 30_000;
const SIDEBAR_COLLAPSED_KEY = "esm-sidebar-collapsed";

function sidebarInboxBadge(href: string, unreadInbox: number): number {
  if ((href === MANAGER_INBOX || href === CUSTOMER_INBOX) && unreadInbox > 0) {
    return unreadInbox;
  }
  return 0;
}

function isPathActive(pathname: string, href: string) {
  if (href === "/vendors") {
    return (
      pathname === "/vendors" ||
      (pathname.startsWith("/vendors/") && !pathname.startsWith("/vendors/aging"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function gatedNavClassName(isBlocked: boolean, active: boolean, className?: string) {
  const parts = [
    "eq-nav-item",
    active ? "eq-nav-item--active" : "",
    isBlocked ? "pointer-events-none cursor-not-allowed opacity-40" : "",
    className ?? "",
  ];
  return parts.filter(Boolean).join(" ");
}

function navLabel(item: NavItem, role: Profile["role"]): string {
  if (item.href === "/technician" && role === "technician") return "My Day";
  if (item.href === "/scheduling" && role === "technician") return "Hours";
  if (item.href === "/timesheets" && role === "technician") return "My Timesheet";
  if (item.href === "/dashboard" && role === "administrator") return "Admin home";
  if (item.href === "/dashboard" && role === "service_manager") return "Operations";
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

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="eq-nav-badge">{count > 99 ? "99+" : count}</span>;
}

function NavLabelWithBadge({ label, count }: { label: string; count?: number }) {
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="truncate">{label}</span>
      <NavBadge count={count ?? 0} />
    </span>
  );
}

function GatedNavLink({
  item,
  pathname,
  className,
  isGateActive,
  blockNavigation,
  badgeCount,
}: {
  item: NavItem;
  pathname: string;
  className?: string;
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
  badgeCount?: number;
}) {
  const router = useRouter();
  const active =
    item.href === CUSTOMER_HOME ? pathname === CUSTOMER_HOME : isPathActive(pathname, item.href);
  const isBlocked = isGateActive && item.href !== CUSTOMER_HOME;
  const label = <NavLabelWithBadge label={item.label} count={badgeCount} />;

  if (isBlocked) {
    return (
      <span
        role="link"
        aria-disabled="true"
        className={gatedNavClassName(true, active, className)}
        onClick={blockNavigation}
      >
        {label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={gatedNavClassName(false, active, className)}
      onClick={(event) => {
        event.preventDefault();
        closeMobileDrawer();
        router.push(item.href);
      }}
    >
      {label}
    </Link>
  );
}

function NavChildList({
  items,
  pathname,
  isGateActive,
  blockNavigation,
  badgeForHref,
}: {
  items: NavItem[];
  pathname: string;
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
  badgeForHref?: (href: string) => number;
}) {
  return (
    <ul className="eq-nav-children">
      {items.map((child) => {
        if (child.children?.length) {
          return (
            <li key={`${child.href}-${child.label}`}>
              <div className="eq-nav-section">{child.label}</div>
              <NavChildList
                items={child.children}
                pathname={pathname}
                isGateActive={isGateActive}
                blockNavigation={blockNavigation}
                badgeForHref={badgeForHref}
              />
            </li>
          );
        }
        return (
          <li key={`${child.href}-${child.label}`}>
            <GatedNavLink
              item={child}
              pathname={pathname}
              isGateActive={isGateActive}
              blockNavigation={blockNavigation}
              badgeCount={badgeForHref?.(child.href)}
            />
          </li>
        );
      })}
    </ul>
  );
}

function NavDetailsGroup({
  item,
  pathname,
  isGateActive,
  blockNavigation,
  badgeForHref,
}: {
  item: NavItem;
  pathname: string;
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
  badgeForHref: (href: string) => number;
}) {
  const router = useRouter();
  const childActive = item.children!.some(function walk(child): boolean {
    if (child.children?.length) return child.children.some(walk);
    return child.href === CUSTOMER_HOME
      ? pathname === CUSTOMER_HOME
      : isPathActive(pathname, child.href);
  });
  const sectionOpen =
    childActive ||
    isPathActive(pathname, item.href) ||
    pathname.startsWith("/vendors/aging") ||
    pathname.startsWith("/service-vendors");
  const parentBlocked = isGateActive && item.href !== CUSTOMER_HOME;
  const parentBadge =
    item.href === "/vendors"
      ? badgeForHref("/vendors") + badgeForHref("/service-vendors")
      : 0;

  return (
    <li className="eq-nav-group">
      {parentBlocked ? (
        <span
          role="link"
          aria-disabled="true"
          className={gatedNavClassName(true, sectionOpen)}
          onClick={blockNavigation}
        >
          <NavLabelWithBadge label={item.label} count={parentBadge} />
        </span>
      ) : (
        <Link
          href={item.href}
          className={gatedNavClassName(false, sectionOpen)}
          onClick={(event) => {
            event.preventDefault();
            closeMobileDrawer();
            router.push(item.href);
          }}
        >
          <NavLabelWithBadge label={item.label} count={parentBadge} />
        </Link>
      )}
      <NavChildList
        items={item.children!}
        pathname={pathname}
        isGateActive={isGateActive}
        blockNavigation={blockNavigation}
        badgeForHref={badgeForHref}
      />
    </li>
  );
}

function NavSection({
  item,
  pathname,
  isGateActive,
  blockNavigation,
  unreadInbox,
  badgeForHref,
}: {
  item: NavItem;
  pathname: string;
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
  unreadInbox: number;
  badgeForHref: (href: string) => number;
}) {
  return (
    <div className="eq-nav-section-block">
      <p className="eq-nav-heading">{item.label}</p>
      {(item.children ?? []).map((child) => {
        if (child.children?.length && !child.section) {
          return (
            <NavDetailsGroup
              key={`${child.href}-${child.label}`}
              item={child}
              pathname={pathname}
              isGateActive={isGateActive}
              blockNavigation={blockNavigation}
              badgeForHref={badgeForHref}
            />
          );
        }
        const active = isPathActive(pathname, child.href);
        const badgeCount =
          sidebarInboxBadge(child.href, unreadInbox) || badgeForHref(child.href);
        return (
          <div key={`${child.href}-${child.label}`} className="eq-nav-row">
            <GatedNavLink
              item={child}
              pathname={pathname}
              className={active ? "eq-nav-item--active" : ""}
              isGateActive={isGateActive}
              blockNavigation={blockNavigation}
              badgeCount={badgeCount}
            />
          </div>
        );
      })}
    </div>
  );
}

function InboxHeaderControl({
  href,
  unreadCount,
  isGateActive,
  blockNavigation,
}: {
  href: string;
  unreadCount: number;
  isGateActive?: boolean;
  blockNavigation?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const pathname = usePathname();
  const active = isPathActive(pathname, href);
  const showBadge = unreadCount > 0;
  const className = `eq-top-icon ${active ? "eq-top-icon--active" : ""}`;

  if (isGateActive && blockNavigation) {
    return (
      <span
        role="link"
        aria-disabled="true"
        aria-label="Inbox"
        className={`${className} pointer-events-none cursor-not-allowed opacity-40`}
        onClick={blockNavigation}
      >
        <Mail className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={className}
      aria-label={showBadge ? `Inbox, ${unreadCount} unread` : "Inbox"}
      title={showBadge ? `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}` : "Inbox"}
    >
      <Mail className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {showBadge ? <span className="eq-top-dot">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
    </Link>
  );
}

function CustomerInboxHeaderControl({
  customerId,
  isGateActive,
  blockNavigation,
}: {
  customerId: string;
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const pathname = usePathname();
  const supabase = createClient();
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnread = useCallback(async () => {
    const count = await countUnreadInboxThreads(supabase, customerId);
    setUnreadCount(count);
  }, [customerId, supabase]);

  useEffect(() => {
    void refreshUnread();
    const onUnreadChanged = () => void refreshUnread();
    window.addEventListener(CUSTOMER_INBOX_UNREAD_EVENT, onUnreadChanged);
    const id = window.setInterval(() => void refreshUnread(), UNREAD_POLL_MS);
    return () => {
      window.removeEventListener(CUSTOMER_INBOX_UNREAD_EVENT, onUnreadChanged);
      window.clearInterval(id);
    };
  }, [refreshUnread, pathname]);

  return (
    <InboxHeaderControl
      href="/customer/inbox"
      unreadCount={unreadCount}
      isGateActive={isGateActive}
      blockNavigation={blockNavigation}
    />
  );
}

function toggleSidebarMenu(onToggleDesktop: () => void) {
  if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
    onToggleDesktop();
    return;
  }
  const toggle = document.getElementById("app-drawer") as HTMLInputElement | null;
  if (toggle) toggle.checked = !toggle.checked;
}

function AppTopBar({
  config,
  inboxControl,
  profile,
  onToggleSidebar,
  onLogout,
}: {
  config: TopbarConfig;
  inboxControl: React.ReactNode;
  profile: Profile;
  onToggleSidebar: () => void;
  onLogout: () => void;
}) {
  const initials = (profile.full_name || profile.email || "?")
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  const showInbox = config.showInbox && Boolean(inboxControl);

  return (
    <header className="eq-topbar">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="eq-top-icon shrink-0"
          onClick={() => toggleSidebarMenu(onToggleSidebar)}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        {config.showSearch ? (
          <div className="eq-search min-w-0 w-full max-w-[480px]">
            <Search className="eq-search-icon" strokeWidth={1.75} />
            <input
              type="search"
              className="eq-search-input"
              placeholder="Search customers, invoices, work orders?"
              aria-label="Search"
              readOnly
              onFocus={(e) => e.currentTarget.blur()}
              title="Search (coming soon)"
            />
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1" aria-hidden />

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {showInbox ? inboxControl : null}

        <div className="eq-user-menu">
          <span className="eq-avatar" aria-hidden>
            {initials || "?"}
          </span>
          <div className="min-w-0 text-left leading-tight">
            <p className="truncate text-[13px] font-semibold text-[#1e2a36]">
              {profile.full_name || profile.email}
            </p>
            <p className="truncate text-[11px] text-[#5c6b7a]">{ROLE_LABELS[profile.role]}</p>
          </div>
        </div>

        <button type="button" className="eq-signout" onClick={onLogout} title="Sign out">
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
          <span className="hidden lg:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}

function SidebarNavBody({
  pathname,
  navItems,
  isGateActive,
  blockNavigation,
  unreadInbox,
  badgeForHref,
  profileEmail,
}: {
  pathname: string;
  navItems: NavItem[];
  isGateActive: boolean;
  blockNavigation: (event: React.MouseEvent<HTMLElement>) => void;
  unreadInbox: number;
  badgeForHref: (href: string) => number;
  profileEmail: string;
}) {
  return (
    <>
      <div className="eq-sidebar-brand">
        <span aria-label="EquipmentIQ">
          <EquipmentIQMark className="h-11 w-11" pop />
        </span>
      </div>

      <div className="px-3 pb-2">
        <DemoPersonaSwitcher currentEmail={profileEmail} variant="dark" />
      </div>

      <div className="eq-sidebar-scroll flex-1 overflow-y-auto px-2.5 pb-4 pt-1">
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
                badgeForHref={badgeForHref}
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
                badgeForHref={badgeForHref}
              />
            );
          }

          const matches = navItems.filter(
            (n) =>
              !n.section &&
              !n.children &&
              (pathname === n.href || pathname.startsWith(`${n.href}/`)),
          );
          const best = [...matches].sort((a, b) => b.href.length - a.href.length)[0];
          const active = best?.href === item.href;
          const badgeCount =
            sidebarInboxBadge(item.href, unreadInbox) || badgeForHref(item.href);
          return (
            <div key={item.href} className="eq-nav-row">
              <GatedNavLink
                item={item}
                pathname={pathname}
                className={active ? "eq-nav-item--active" : ""}
                isGateActive={isGateActive}
                blockNavigation={blockNavigation}
                badgeCount={badgeCount}
              />
            </div>
          );
        })}
      </div>

      <div className="eq-sidebar-foot">
        <p className="text-[11px] font-medium text-white/45">EquipmentIQ</p>
        <p className="mt-0.5 text-[10px] text-white/30">Field service ?? Billing ?? Operations</p>
      </div>
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
  const [pendingByHref, setPendingByHref] = useState<Record<string, number>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const topbarConfig = topbarConfigForRole(profile.role);
  const isCustomer = profile.role === "customer";
  const showStaffInbox = usesStaffInbox(profile.role);
  const showCustomerInbox = isCustomer && Boolean(profile.customer_id);
  const pollStaffInbox = showStaffInbox;
  const pollCustomerInbox = showCustomerInbox;

  const navItems = filterNavForProfile(profile).map((item) => labeledNavItem(item, profile.role));

  const refreshUnread = useCallback(async () => {
    try {
      const supabase = createClient();
      if (pollStaffInbox) {
        const count = await fetchManagerUnreadInboxCount(supabase);
        setUnreadInbox(count);
        return;
      }
      if (pollCustomerInbox && profile.customer_id) {
        const count = await countUnreadInboxThreads(supabase, profile.customer_id);
        setUnreadInbox(count);
        return;
      }
      setUnreadInbox(0);
    } catch {
      /* keep last known count */
    }
  }, [pollCustomerInbox, pollStaffInbox, profile.customer_id]);

  useEffect(() => {
    setMounted(true);
    try {
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!pollStaffInbox && !pollCustomerInbox) return;
    void refreshUnread();
    const onUnreadChanged = () => void refreshUnread();
    const unreadEvent = pollStaffInbox ? MANAGER_INBOX_UNREAD_EVENT : CUSTOMER_INBOX_UNREAD_EVENT;
    window.addEventListener(unreadEvent, onUnreadChanged);
    const id = window.setInterval(() => void refreshUnread(), UNREAD_POLL_MS);
    return () => {
      window.removeEventListener(unreadEvent, onUnreadChanged);
      window.clearInterval(id);
    };
  }, [pollCustomerInbox, pollStaffInbox, refreshUnread, pathname]);

  useEffect(() => {
    const canVendors = ["administrator", "service_manager", "billing"].includes(profile.role);
    if (!canVendors) {
      setPendingByHref({});
      return;
    }
    let cancelled = false;
    async function loadPending() {
      const supabase = createClient();
      const [suppliers, services] = await Promise.all([
        supabase
          .from("vendors")
          .select("id", { count: "exact", head: true })
          .eq("approval_status", "Pending"),
        supabase
          .from("service_vendors")
          .select("id", { count: "exact", head: true })
          .eq("approval_status", "Pending"),
      ]);
      if (cancelled) return;
      setPendingByHref({
        "/vendors": suppliers.count ?? 0,
        "/service-vendors": services.count ?? 0,
      });
    }
    void loadPending();
    return () => {
      cancelled = true;
    };
  }, [profile.role, pathname]);

  const gateActive = mounted && isGateActive;

  function badgeForHref(href: string) {
    if (sidebarInboxBadge(href, unreadInbox) > 0) return unreadInbox;
    return pendingByHref[href] ?? 0;
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((v) => !v);
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const inboxControl =
    showCustomerInbox && topbarConfig.showInbox ? (
      <CustomerInboxHeaderControl
        customerId={profile.customer_id!}
        isGateActive={gateActive}
        blockNavigation={blockNavigation}
      />
    ) : showStaffInbox && topbarConfig.showInbox ? (
      <InboxHeaderControl href="/inbox" unreadCount={unreadInbox} />
    ) : null;

  const desktopSidebarHidden = sidebarCollapsed;

  const sidebarBodyProps = {
    pathname,
    navItems,
    isGateActive: gateActive,
    blockNavigation,
    unreadInbox,
    badgeForHref,
    profileEmail: profile.email,
  };

  return (
    <div className="eq-shell min-h-screen lg:flex">
      {!desktopSidebarHidden ? (
        <aside className="eq-sidebar relative z-10 hidden w-[15.75rem] shrink-0 flex-col lg:flex">
          <SidebarNavBody {...sidebarBodyProps} />
        </aside>
      ) : null}

      <div className="drawer min-h-screen min-w-0 flex-1">
        <input id="app-drawer" type="checkbox" className="drawer-toggle" />
        <div className="drawer-content flex min-h-screen flex-col">
          <AppTopBar
            config={topbarConfig}
            inboxControl={inboxControl}
            profile={profile}
            onToggleSidebar={toggleSidebarCollapsed}
            onLogout={() => void logout()}
          />

          {gateActive ? (
            <div
              role="status"
              className="border-b border-amber-300/80 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-950"
            >
              Submit your service rating on Home to continue using the portal.
            </div>
          ) : null}

          <main className="eq-main flex-1">
            <div className="eq-page">{children}</div>
          </main>
        </div>

        <aside className="drawer-side z-40 lg:hidden">
          <label htmlFor="app-drawer" className="drawer-overlay" aria-label="Close menu" />
          <nav className="eq-sidebar relative z-10 flex min-h-full w-[15.75rem] flex-col">
            <SidebarNavBody {...sidebarBodyProps} />
          </nav>
        </aside>
      </div>
    </div>
  );
}
