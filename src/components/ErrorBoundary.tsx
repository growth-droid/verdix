import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; resetKey?: string }
type State = { error: Error | null }

/** Catches render-time errors in any page so one bad view degrades to a recovery
 *  card instead of a blank white screen. Resets when the route (resetKey) changes. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidUpdate(prev: Props) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('View error:', error, info.componentStack) }

  render() {
    if (this.state.error) {
      return (
        <div className="card p-8 max-w-xl mx-auto mt-10 text-center">
          <div className="text-3xl mb-2">⚠</div>
          <h2 className="font-bold text-lg mb-1">This view hit a snag</h2>
          <p className="text-sm text-muted mb-4">Something in this module failed to render. The rest of the dashboard is fine — try another tab, or reload.</p>
          <pre className="text-[11px] text-faint bg-slate-950/60 border border-white/10 rounded-lg p-3 text-left overflow-auto max-h-32 mb-4">{this.state.error.message}</pre>
          <button onClick={() => location.reload()} className="text-sm px-4 py-2 rounded-lg border border-white/15 text-ink hover:border-white/30 transition-colors">Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
