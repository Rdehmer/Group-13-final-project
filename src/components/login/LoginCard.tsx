"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEMO_PASSWORD, DEMO_PERSONAS } from "@/lib/demo-personas";
import { EquipmentIQLogo } from "@/components/brand/EquipmentIQLogo";

type AuthMode = "login" | "signup";

type Props = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  showBrand?: boolean;
  embedded?: boolean;
};

export function LoginCard({ mode, onModeChange, showBrand = true, embedded = false }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
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
          options: {
            data: {
              full_name: fullName,
              business_name: businessName,
            },
          },
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
    <div
      className={
        embedded
          ? "p-6 sm:p-8"
          : "rounded-box border border-base-300/60 bg-base-100 p-6 shadow-xl sm:p-8"
      }
    >
      {showBrand ? (
        <div className="mb-6 flex flex-col items-center text-center">
          <EquipmentIQLogo variant="auth" className="mx-auto" />
          <p className="mt-4 text-sm text-slate-600">
            Commercial equipment service, from request to invoice
          </p>
        </div>
      ) : null}

      <div className="tabs tabs-boxed mb-5">
        <button
          type="button"
          className={`tab flex-1 ${mode === "login" ? "tab-active" : ""}`}
          onClick={() => onModeChange("login")}
        >
          Sign In
        </button>
        <button
          type="button"
          className={`tab flex-1 ${mode === "signup" ? "tab-active" : ""}`}
          onClick={() => onModeChange("signup")}
        >
          Sign Up
        </button>
      </div>

      {error ? (
        <div role="alert" className="alert alert-error mb-4 text-sm">
          <span>{error}</span>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">
          {mode === "login" ? "Welcome back" : "Create an account"}
        </h2>

        {mode === "signup" ? (
          <>
            <label className="form-control grid grid-cols-[7rem_1fr] items-center gap-3">
              <span className="label-text font-medium">Business name</span>
              <input
                className="input input-bordered w-full"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Your company"
                required
              />
            </label>
            <label className="form-control grid grid-cols-[7rem_1fr] items-center gap-3">
              <span className="label-text font-medium">Full Name</span>
              <input
                className="input input-bordered w-full"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </label>
          </>
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
            placeholder={DEMO_PASSWORD}
            required
            minLength={8}
          />
        </label>

        <button type="submit" className="btn btn-primary mt-1 w-full" disabled={loading}>
          {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>

      <div className="mt-6 border-t border-base-300/60 pt-5 text-sm">
        <p className="font-semibold">Demo accounts — click to fill (password: {DEMO_PASSWORD})</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO_PERSONAS.map((acct) => (
            <button
              key={acct.email}
              type="button"
              className="btn btn-outline btn-xs"
              onClick={() => {
                onModeChange("login");
                setEmail(acct.email);
                setPassword(DEMO_PASSWORD);
                setError(null);
              }}
            >
              {acct.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs opacity-60">
          Best demo flow: Manager job → Tech PO/labor → Billing invoice → Payments.
        </p>
      </div>
    </div>
  );
}
