"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { AlertIcon, MessageIcon, PhoneIcon, UsersIcon } from "./Icons";
import ThemeToggle from "./ThemeToggle";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { user, loading, login, register } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(identifier, password);
      } else {
        await register({ username, displayName, email, password });
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <main className="auth-layout">
      <aside className="auth-aside" aria-hidden="true">
        <div className="brand">
          <span className="brand-mark">
            <MessageIcon size={18} />
          </span>
          <span className="brand-name">Chat</span>
        </div>
        <div className="auth-aside-body">
          <h2>Conversations and calls, in one place.</h2>
          <p>Message your friends in real time and move to a voice or video call without leaving the thread.</p>
          <ul className="feature-list">
            <li>
              <span className="feature-icon">
                <MessageIcon size={16} />
              </span>
              <div>
                <strong>Live messaging</strong>
                <span>Typing indicators plus delivery and read receipts.</span>
              </div>
            </li>
            <li>
              <span className="feature-icon">
                <PhoneIcon size={16} />
              </span>
              <div>
                <strong>Audio and video calls</strong>
                <span>Call anyone who is online, straight from the chat.</span>
              </div>
            </li>
            <li>
              <span className="feature-icon">
                <UsersIcon size={16} />
              </span>
              <div>
                <strong>Friends and presence</strong>
                <span>Send requests and see who is available right now.</span>
              </div>
            </li>
          </ul>
        </div>
      </aside>

      <section className="auth-main">
        <div className="auth-topbar">
          <div className="brand brand-compact">
            <span className="brand-mark">
              <MessageIcon size={18} />
            </span>
            <span className="brand-name">Chat</span>
          </div>
          <ThemeToggle />
        </div>

        <form className="auth-card" onSubmit={onSubmit}>
          <h1>{isLogin ? "Welcome back" : "Create your account"}</h1>
          <p className="subtitle">
            {isLogin ? "Sign in to continue chatting" : "Chat, call and video call your friends"}
          </p>

          {isLogin ? (
            <div className="input-group">
              <label htmlFor="identifier">Username or email</label>
              <input
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>
          ) : (
            <>
              <div className="input-group">
                <label htmlFor="displayName">Display name</label>
                <input
                  id="displayName"
                  autoComplete="name"
                  maxLength={60}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
              <div className="input-group">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  autoComplete="username"
                  minLength={3}
                  maxLength={30}
                  pattern="[A-Za-z0-9_]+"
                  title="Letters, numbers and underscores only"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
                <small className="hint">Letters, numbers and underscores only</small>
              </div>
              <div className="input-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={isLogin ? undefined : 8}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {!isLogin && <small className="hint">At least 8 characters</small>}
          </div>

          {error && (
            <p className="error-message" role="alert">
              <AlertIcon size={16} />
              <span>{error}</span>
            </p>
          )}

          <button className="btn-primary btn-block" type="submit" disabled={submitting}>
            {submitting ? "Please wait..." : isLogin ? "Sign in" : "Create account"}
          </button>

          <p className="auth-switch">
            {isLogin ? (
              <>
                New here? <Link href="/register">Create an account</Link>
              </>
            ) : (
              <>
                Already registered? <Link href="/login">Sign in</Link>
              </>
            )}
          </p>
        </form>
      </section>
    </main>
  );
}
