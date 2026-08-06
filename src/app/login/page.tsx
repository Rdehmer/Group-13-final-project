"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DEMO_PASSWORD, DEMO_PERSONAS } from "@/lib/demo-personas";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (authError) {
          setError(
            authError.message.includes("Invalid login")
              ? "That email or password doesn't match our records. Try a demo account below."
              : authError.message,
          );
          return;
        }
      } else {
        const { error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (authError) {
          setError(authError.message);
          return;
        }
      }
      router.push("/welcome");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <section className="eq-login-hero relative hidden flex-col justify-between p-10 text-white lg:flex">
        <div>
          <div className="inline-flex rounded-2xl bg-white px-4 py-3 shadow-lg">
            <Image
              src="/equipmentiq-logo.png"
              alt="EquipmentIQ"
              width={220}
              height={52}
              className="h-12 w-auto object-contain"
              priority
            />
          </div>
          <p className="mt-8 max-w-md text-lg font-medium leading-relaxed text-white/90">
            Intelligent equipment service — schedule technicians, manage contracts, track parts, and
            close the loop from request through invoice.
          </p>
        </div>
        <ul className="space-y-3 text-sm text-white/85">
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#00c2c5]" /> Role-based access for managers, techs, billing,
            and customers
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#00c2c5]" /> Work order lifecycle with approval controls
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#00c2c5]" /> Profitability and AR aging at a glance
          </li>
        </ul>
      </section>

      <section className="flex flex-col justify-center bg-[#eef2f5] p-6 sm:p-10">
        <div className="mb-6 lg:hidden">
          <Image
            src="/equipmentiq-logo.png"
            alt="EquipmentIQ"
            width={180}
            height={44}
            className="h-10 w-auto object-contain"
            priority
          />
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="tabs tabs-boxed mb-6 bg-white">
            <button
              type="button"
              className={`tab flex-1 ${mode === "login" ? "tab-active !bg-[#00a3a6] !text-white" : ""}`}
              onClick={() => setMode("login")}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`tab flex-1 ${mode === "signup" ? "tab-active !bg-[#00a3a6] !text-white" : ""}`}
              onClick={() => setMode("signup")}
            >
              Sign Up
            </button>
          </div>

          {error ? (
            <div role="alert" className="alert alert-error mb-4 text-sm">
              <span>{error}</span>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="card border border-[#dce3ea] bg-white shadow-lg">
            <div className="card-body gap-4">
              <h2 className="card-title text-lg text-[#1e2a36]">
                {mode === "login" ? "Welcome back" : "Create an account"}
              </h2>

              {mode === "signup" ? (
                <label className="form-control w-full">
                  <span className="label-text font-medium">Full name</span>
                  <input
                    className="input input-bordered w-full"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </label>
              ) : null}

              <label className="form-control w-full">
                <span className="label-text font-medium">Email</span>
                <input
                  type="email"
                  className="input input-bordered w-full"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="form-control w-full">
                <span className="label-text font-medium">Password</span>
                <input
                  type="password"
                  className="input input-bordered w-full"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </label>

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </div>
          </form>

          <div className="mt-6 rounded-xl border border-[#dce3ea] bg-white p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#5c6b7a]">
              Demo accounts
            </p>
            <p className="mb-3 text-xs text-[#5c6b7a]">Password: {DEMO_PASSWORD}</p>
            <div className="flex flex-col gap-2">
              {DEMO_PERSONAS.map((persona) => (
                <button
                  key={persona.id}
                  type="button"
                  className="btn btn-outline btn-sm justify-start"
                  onClick={() => {
                    setMode("login");
                    setEmail(persona.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                >
                  {persona.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
