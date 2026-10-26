"use client";

import { useState } from "react";

function safeNextPath(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default function LoginForm() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Login failed.");
      }
      const params = new URLSearchParams(window.location.search);
      window.location.assign(safeNextPath(params.get("next")));
    } catch (error) {
      setStatus(error.message);
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-logos" aria-label="AKT">
          <img src="/akt-logo.png" alt="AKT" />
        </div>
        <h1 id="login-title">Media Tool List</h1>
        <p>Sign in to continue</p>
        <form onSubmit={submitLogin}>
          <label>
            <span>ID</span>
            <input
              autoComplete="username"
              autoFocus
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              type="text"
              required
            />
          </label>
          <label>
            <span>Site password</span>
            <span className="password-field">
              <input
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                required
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="password-visibility"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                  {showPassword ? (
                    <>
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                      <path d="M9.1 5.2A10.6 10.6 0 0 1 12 4.8c5.2 0 8.5 4.5 9.6 6.4a1.6 1.6 0 0 1 0 1.6 17.2 17.2 0 0 1-2.1 2.8" />
                      <path d="M6.7 6.8a17.5 17.5 0 0 0-4.3 4.4 1.6 1.6 0 0 0 0 1.6c1.1 1.9 4.4 6.4 9.6 6.4a10.7 10.7 0 0 0 4.1-.8" />
                    </>
                  ) : (
                    <>
                      <path d="M2.4 11.2a1.6 1.6 0 0 0 0 1.6c1.1 1.9 4.4 6.4 9.6 6.4s8.5-4.5 9.6-6.4a1.6 1.6 0 0 0 0-1.6C20.5 9.3 17.2 4.8 12 4.8s-8.5 4.5-9.6 6.4Z" />
                      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                    </>
                  )}
                </svg>
              </button>
            </span>
          </label>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
          {status ? <strong role="alert">{status}</strong> : null}
        </form>
      </section>
    </main>
  );
}
