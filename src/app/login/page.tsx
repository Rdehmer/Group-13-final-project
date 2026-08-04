"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeSelector } from "@/components/ThemeSelector";

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
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <section className="hero-equipment relative hidden flex-col justify-between p-10 text-primary-content lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <Wrench className="h-8 w-8" />
            <div>
              <p className="text-sm uppercase tracking-widest opacity-80">Ridley Equipment Services</p>
              <h1 className="text-3xl font-bold">Equipment Service Manager</h1>
            </div>
          </div>
          <p className="mt-8 max-w-md text-lg opacity-90">
            Schedule technicians, track parts, manage contracts, and keep commercial equipment running
            with full visibility from request to invoice.
          </p>
        </div>
        <ul className="space-y-3 text-sm opacity-90">
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Role-based access for managers, techs, billing, and customers
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Work order lifecycle with approval controls
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Profitability and AR aging at a glance
          </li>
        </ul>
      </section>

      <section className="flex flex-col justify-center p-6 sm:p-10">
        <div className="mb-6 flex items-center justify-between lg:justify-end">
          <div className="lg:hidden">
            <h1 className="text-xl font-bold">Equipment Service Manager</h1>
            <p className="text-sm opacity-70">Ridley Equipment Services</p>
          </div>
          <ThemeSelector compact />
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="tabs tabs-boxed mb-6">
            <button
              type="button"
              className={`tab flex-1 ${mode === "login" ? "tab-active" : ""}`}
              onClick={() => setMode("login")}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`tab flex-1 ${mode === "signup" ? "tab-active" : ""}`}
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

          <form onSubmit={onSubmit} className="card bg-base-100 shadow-xl">
            <div className="card-body gap-4">
              <h2 className="card-title text-lg">
                {mode === "login" ? "Welcome back" : "Create an account"}
              </h2>

              {mode === "signup" ? (
                <label className="form-control grid grid-cols-[7rem_1fr] items-center gap-3">
                  <span className="label-text font-medium">Full name</span>
                  <input
                    className="input input-bordered w-full"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </label>
              ) : null}

              <label className="form-control grid grid-cols-[7rem_1fr] items-center gap-3">
                <span className="label-text font-medium">Email</span>
                <input
                  type="email"
                  className="input input-bordered w-full"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </label>

              <label className="form-control grid grid-cols-[7rem_1fr] items-center gap-3">
                <span className="label-text font-medium">Password</span>
                <input
                  type="password"
                  className="input input-bordered w-full"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="DemoPass123!"
                  required
                  minLength={8}
                />
              </label>

              <button type="submit" className="btn btn-primary mt-2" disabled={loading}>
                {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
              </button>
            </div>
          </form>

          <div className="mt-6 rounded-box bg-base-100 p-4 text-sm shadow">
            <p className="font-semibold">Demo accounts (password: DemoPass123!)</p>
            <ul className="mt-2 space-y-1 opacity-80">
              <li>admin@ridley-demo.test — Administrator</li>
              <li>manager@ridley-demo.test — Service Manager</li>
              <li>tech1@ridley-demo.test — Technician</li>
              <li>billing@ridley-demo.test — Billing</li>
              <li>customer1@ridley-demo.test — Customer Portal</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
