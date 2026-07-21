import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; info: string; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: "" };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error.message, info.componentStack?.slice(0, 500));
    this.setState({ info: info.componentStack?.slice(0, 300) ?? "" });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "hsl(var(--background))", padding: "24px", textAlign: "center", gap: "16px" }}>
          <div style={{ fontSize: "40px" }}>⚠️</div>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "hsl(var(--foreground))" }}>Something went wrong</div>
          <div style={{ fontSize: "13px", color: "hsl(var(--muted-foreground))", maxWidth: "320px", lineHeight: 1.5 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => { this.setState({ error: null, info: "" }); window.location.reload(); }}
            style={{ background: "var(--gradient-gold)", color: "hsl(var(--primary-foreground))", padding: "12px 24px", borderRadius: "12px", fontSize: "14px", fontWeight: "700", border: "none", cursor: "pointer", marginTop: "8px" }}>
            Reload app
          </button>
          <details style={{ textAlign: "left", maxWidth: "320px", marginTop: "8px" }}>
            <summary style={{ fontSize: "11px", color: "hsl(var(--muted-foreground) / 0.7)", cursor: "pointer" }}>Technical details</summary>
            <pre style={{ fontSize: "9px", color: "hsl(var(--muted-foreground) / 0.7)", marginTop: "8px", overflow: "auto", maxHeight: "160px", background: "hsl(var(--secondary))", padding: "12px", borderRadius: "8px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.error.stack}{"\n\n"}{this.state.info}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
