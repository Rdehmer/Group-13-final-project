"use client";

import { useCallback, useState } from "react";
import {
  FileText,
  Truck,
  Receipt,
  Users,
  HardHat,
  Building2,
  ArrowRight,
} from "lucide-react";
import { AuthModal } from "@/components/login/AuthModal";
import { EquipmentIQLogo } from "@/components/brand/EquipmentIQLogo";

type AuthMode = "login" | "signup";

const ROLES = [
  {
    icon: Building2,
    title: "Managers",
    description: "Approve work, schedule the team, and see job status without chasing calls.",
  },
  {
    icon: HardHat,
    title: "Technicians",
    description: "Open My Day, capture labor and parts, and close jobs with clear proof.",
  },
  {
    icon: Users,
    title: "Customers",
    description: "Request service, review contracts, and pay invoices in one place.",
  },
] as const;

const CAPABILITIES = [
  {
    icon: FileText,
    title: "Contracts & coverage",
    description:
      "Track service agreements, equipment under contract, and coverage so the office and field stay aligned.",
  },
  {
    icon: Truck,
    title: "Field & parts",
    description:
      "Dispatch technicians, log parts used on the job, and keep work moving from request to completion.",
  },
  {
    icon: Receipt,
    title: "Billing & AR",
    description:
      "Turn finished work into invoices, collect payments, and keep receivables visible for finance.",
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
    <div className="home-landing flex min-h-screen flex-col bg-base-200">
      <header className="home-landing-header sticky top-0 z-30 border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <EquipmentIQLogo variant="header" onDark />
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="btn btn-sm min-h-10 border-2 border-white/70 bg-transparent text-white hover:border-white hover:bg-white/10 sm:btn-md"
              onClick={() => openAuth("login")}
            >
              Sign In
            </button>
            <button
              type="button"
              className="btn btn-sm border-0 bg-teal-500 text-white hover:bg-teal-400 sm:btn-md"
              onClick={() => openAuth("signup")}
            >
              Sign Up
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="home-hero relative overflow-hidden px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
          <div className="home-landing-rise relative mx-auto flex max-w-6xl flex-col items-start">
            <EquipmentIQLogo variant="hero" onDark />
            <h1 className="mt-8 max-w-2xl text-left text-2xl font-semibold leading-snug !text-white sm:text-3xl lg:text-4xl">
              Commercial equipment service, from request to invoice
            </h1>
            <p className="mt-5 max-w-xl text-left text-base leading-relaxed text-white/75 sm:text-lg">
              One place for managers, technicians, billing, and customers to keep equipment running
              without the paperwork chase.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button
                type="button"
                className="home-cta-primary inline-flex min-h-12 items-center justify-center rounded-lg px-6 text-base font-semibold shadow-sm transition"
                onClick={() => openAuth("login")}
              >
                Sign In
              </button>
              <button
                type="button"
                className="home-cta-secondary inline-flex min-h-12 items-center justify-center rounded-lg border-2 px-6 text-base font-semibold transition"
                onClick={() => openAuth("signup")}
              >
                Create Account
              </button>
            </div>
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display text-2xl font-bold text-slate-800 sm:text-3xl">Who it’s for</h2>
            <p className="mt-2 max-w-2xl text-base text-slate-600">
              Built for the people who keep commercial equipment online—each role gets a clear path
              in.
            </p>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {ROLES.map(({ icon: Icon, title, description }) => (
                <article
                  key={title}
                  className="home-role-card rounded-2xl border border-base-300/70 bg-base-100 p-5 sm:p-6"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500/10 text-teal-700">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-800">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
                  <button
                    type="button"
                    className="btn btn-link btn-sm mt-4 h-auto min-h-0 px-0 text-teal-700"
                    onClick={() => openAuth("login")}
                  >
                    Sign In
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-base-300/50 bg-base-100 px-4 py-14 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display text-2xl font-bold text-slate-800 sm:text-3xl">What you can run</h2>
            <p className="mt-2 max-w-2xl text-base text-slate-600">
              The core of the shop—coverage, field work, and getting paid—without extra clutter.
            </p>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {CAPABILITIES.map(({ icon: Icon, title, description }) => (
                <article
                  key={title}
                  className="home-capability rounded-2xl border border-base-300/70 bg-base-100 p-5 sm:p-6"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500/10 text-teal-700">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-800">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-base-300/50 bg-base-100 px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <EquipmentIQLogo variant="footer" />
            <p className="text-sm text-slate-500">Powered by Ridley Equipment Services</p>
          </div>
          <div className="flex gap-4 text-sm">
            <button type="button" className="link link-hover text-teal-700" onClick={() => openAuth("login")}>
              Sign In
            </button>
            <button type="button" className="link link-hover text-teal-700" onClick={() => openAuth("signup")}>
              Sign Up
            </button>
          </div>
        </div>
      </footer>

      <AuthModal open={authOpen} mode={mode} onModeChange={setMode} onClose={closeAuth} />
    </div>
  );
}
