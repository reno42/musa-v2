import React, { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught render error:", error.message, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", minHeight: "100vh", padding: 40,
          background: "#0a0a0a", color: "#f5f5f5", fontFamily: "system-ui, sans-serif",
        }}>
          <div style={{
            maxWidth: 480, textAlign: "center", padding: 32,
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
            background: "rgba(255,255,255,0.03)",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginBottom: 24 }}>
              An unexpected error occurred. Your work is safe — it was saved locally before the crash.
            </p>
            <pre style={{
              fontSize: 12, textAlign: "left", padding: 12,
              background: "rgba(0,0,0,0.3)", borderRadius: 8,
              color: "#f87171", marginBottom: 24, maxHeight: 120, overflow: "auto",
            }}>
              {this.state.error?.message || "Unknown error"}
            </pre>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button onClick={this.handleReset} style={{
                padding: "10px 24px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", fontSize: 14,
              }}>
                Try Again
              </button>
              <button onClick={() => { window.location.href = "/"; }} style={{
                padding: "10px 24px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
                background: "transparent", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 14,
              }}>
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
