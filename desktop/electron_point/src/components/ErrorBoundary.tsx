import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  pageName?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.pageName ?? 'unknown'}]`, error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <div className="h-9 drag-region absolute inset-x-0 top-0" />
          <p className="text-base font-semibold">Что-то пошло не так</p>
          <p className="text-sm text-muted-foreground max-w-xs break-words">
            {this.state.error?.message || 'Неизвестная ошибка'}
          </p>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Попробовать снова
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
