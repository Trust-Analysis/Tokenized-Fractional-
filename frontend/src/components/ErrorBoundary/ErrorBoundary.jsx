import { Component } from 'react';

/**
 * React Error Boundary — catches render-phase errors in its subtree.
 * Usage: <ErrorBoundary fallback={ErrorFallback}> ... </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
    this.resetError = this.resetError.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack });
  }

  resetError() {
    this.setState({ hasError: false, error: null, componentStack: null });
  }

  render() {
    if (this.state.hasError) {
      const Fallback = this.props.fallback;
      return (
        <Fallback
          error={this.state.error}
          componentStack={this.state.componentStack}
          resetError={this.resetError}
        />
      );
    }
    return this.props.children;
  }
}
