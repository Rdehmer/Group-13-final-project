"use client";

import { useCallback, useState } from "react";
import {
  Wrench,
  ClipboardList,
  FileText,
  Truck,
  Receipt,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import { AuthModal } from "@/components/login/AuthModal";

type AuthMode = "login" | "signup";

const FEATURES = [
  {
    icon: ClipboardList,
    title: "Work order lifecycle",
    description: "Request, dispatch, complete, and invoice — with full approval controls.",
  },
  {
    icon: FileText,
    title: "Service contracts",
    description: "Industry-tailored coverage tiers, caps, and contract management in one place.",
  },
  {
    icon: Truck,
    title: "Field dispatch",
    description: "Schedule technicians, track parts, and keep jobs moving without the chaos.",
  },
  {
    icon: Receipt,
    title: "Billing & AR",
    description: "Invoices, payments, profitability, and aging — ready when finance needs it.",
  },
] as const;

export function HomeLanding() {
  const [authOpen, setAuthOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");

  const openAuth = useCallback((nextMode: AuthMode) => {
    setMode(nextMode);
    setAuthOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setAuthOpen(false);
  }, []);

  return (
    <div className="home-landing flex min-h-screen flex-col">
      <header className="border-b border-base-300/50 bg-base-100/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Wrench className="h-5 w-5" aria-hidden />
            </div>
            <span className="font-display text-lg font-bold tracking-tight sm:text-xl">EquipmentIQ</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={() => openAuth("login")}>
              Sign In
            </button>
            <button type="button" className="btn btn-primary btn-sm sm:btn-md" onClick={() => openAuth("signup")}>
              Sign Up
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="home-hero relative overflow-hidden px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
          <div className="relative mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary sm:text-sm">
                Commercial equipment service platform
              </p>
              <h1 className="font-display mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Run your service operation with clarity
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed opacity-75 sm:text-lg">
                EquipmentIQ connects managers, technicians, billing, and customers — from the first
                service request through contract coverage, dispatch, and invoice.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary btn-md sm:btn-lg" onClick={() => openAuth("login")}>
                  Sign In
                </button>
                <button type="button" className="btn btn-outline btn-md sm:btn-lg" onClick={() => openAuth("signup")}>
                  Create Account
                </button>
              </div>
              <ul className="mt-10 space-y-2.5 text-sm opacity-80 sm:text-base">
                <li className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                  Role-based access for every team
                </li>
                <li className="flex items-center gap-2.5">
                  <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
                  Profitability and AR aging at a glance
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="border-t border-base-300/50 bg-base-100 px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="font-display text-2xl font-bold sm:text-3xl">Built for commercial equipment teams</h2>
              <p className="mt-3 opacity-70">
                Everything your shop needs to keep equipment running and customers informed.
              </p>
            </div>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <article
                  key={title}
                  className="card bg-base-200/50 p-5 transition-shadow hover:shadow-md"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed opacity-70">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-base-300/50 px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-center text-sm opacity-60 sm:flex-row sm:text-left">
          <p>EquipmentIQ — commercial equipment service management</p>
          <div className="flex gap-4">
            <button type="button" className="link link-hover" onClick={() => openAuth("login")}>
              Sign In
            </button>
            <button type="button" className="link link-hover" onClick={() => openAuth("signup")}>
              Sign Up
            </button>
          </div>
        </div>
      </footer>

      <AuthModal open={authOpen} mode={mode} onModeChange={setMode} onClose={closeAuth} />
    </div>
  );
}
