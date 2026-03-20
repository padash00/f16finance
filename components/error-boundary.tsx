'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error)
    // Report to client-log endpoint
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'error', message: error.message, stack: error.stack }),
    }).catch(() => null)
  }

  reset = () => this.setState({ hasError: false, error: null })

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-8 text-center">
          <p className="text-sm font-medium text-rose-400">Что-то пошло не так</p>
          <p className="text-xs text-gray-500">{this.state.error?.message}</p>
          <button
            onClick={this.reset}
            className="rounded-lg bg-rose-500/20 px-4 py-2 text-xs text-rose-300 hover:bg-rose-500/30 transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
