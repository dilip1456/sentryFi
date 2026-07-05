import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center gap-4">
          <div className="text-4xl">⚠️</div>
          <h2 className="font-display text-xl text-foreground">Something went wrong</h2>
          <p className="text-[13px] text-muted-foreground max-w-sm">
            {this.state.error.message}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="bg-gold px-5 py-2.5 rounded-lg text-[13px] font-semibold mt-2"
          >
            Reload app
          </button>
          <details className="text-left max-w-sm">
            <summary className="text-[11px] text-muted-foreground cursor-pointer">Technical details</summary>
            <pre className="text-[10px] text-muted-foreground mt-2 overflow-auto max-h-40 bg-secondary/30 p-3 rounded">
              {this.state.error.stack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
