import { useState } from "react";

interface LoginPageProps {
  onLogin: (email: string) => Promise<{ error?: string }>;
  onSkipLogin?: () => void;
}

export function LoginPage({ onLogin, onSkipLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError(null);

    const result = await onLogin(email.trim());

    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
    }

    setLoading(false);
  };

  if (sent) {
    return (
      <div className="login-page">
        <div className="login-card">
          <svg width="48" height="48" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="8" fill="#6366f1" />
            <path d="M12 28V12h6l5 8 5-8h6v16h-5V18l-6 10-6-10v10z" fill="white" />
          </svg>
          <h1>Check your email</h1>
          <p>
            We sent a magic link to <strong>{email}</strong>. Click the link to sign in.
          </p>
          <button className="login-btn secondary" onClick={() => setSent(false)}>
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <svg width="48" height="48" viewBox="0 0 40 40" fill="none">
          <rect width="40" height="40" rx="8" fill="#6366f1" />
          <path d="M12 28V12h6l5 8 5-8h6v16h-5V18l-6 10-6-10v10z" fill="white" />
        </svg>
        <h1>Futuraria Design</h1>
        <p>Sign in to access your templates</p>

        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            className="login-input"
            disabled={loading}
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn" disabled={loading || !email.trim()}>
            {loading ? "Sending..." : "Send Magic Link"}
          </button>
        </form>

        {onSkipLogin && (
          <button className="login-skip" onClick={onSkipLogin}>
            Continue without login (local mode)
          </button>
        )}
      </div>
    </div>
  );
}
