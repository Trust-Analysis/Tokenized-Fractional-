import { Component } from 'react';
import * as Sentry from '@sentry/react';

/**
 * Enhanced React Error Boundary — catches render-phase errors and logs to Sentry.
 *
 * Props:
 *   - fallback: React component to render when error is caught
 *   - routeName: (optional) name of the route for context (e.g., "Marketplace", "Portfolio")
 *   - onError: (optional) callback when error occurs
 *   - children: JSX to wrap
 *
 * Features:
 *   - Captures errors and logs to Sentry with context
 *   - Includes component stack trace, route info, and breadcrumbs
 *   - Provides error severity classification
 *   - Captures user/environment context for debugging
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      componentStack: null,
      errorId: null,
      timestamp: null,
      severity: 'error',
    };
    this.resetError = this.resetError.bind(this);
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
      timestamp: new Date().toISOString(),
    };
  }

  componentDidCatch(error, info) {
    // Generate unique error ID for correlation
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const componentStack = info.componentStack;

    // Classify severity based on error type
    let severity = 'error';
    if (error?.message?.includes('NetworkError') || error?.message?.includes('timeout')) {
      severity = 'warning';
    } else if (error?.message?.includes('OutOfMemory') || error?.message?.includes('SecurityError')) {
      severity = 'critical';
    }

    this.setState({ errorInfo: info, componentStack, errorId, severity });

    // Log to console in development
    console.error('[ErrorBoundary] Caught error:', {
      errorId,
      error,
      componentStack,
      routeName: this.props.routeName,
      timestamp: this.state.timestamp,
    });

    // Capture breadcrumbs for error context
    if (Sentry) {
      Sentry.addBreadcrumb({
        category: 'react.error',
        level: 'error',
        message: `Error in ${this.props.routeName || 'component'}`,
        data: {
          errorId,
          routeName: this.props.routeName,
        },
      });

      // Capture exception with full context
      Sentry.captureException(error, {
        contexts: {
          react: {
            errorId,
            routeName: this.props.routeName,
            componentStack,
            severity,
          },
        },
        tags: {
          error_boundary: 'true',
          route: this.props.routeName || 'unknown',
          severity,
        },
        level: severity === 'critical' ? 'fatal' : severity === 'warning' ? 'warning' : 'error',
      });
    }

    // Call optional error callback
    if (this.props.onError) {
      this.props.onError(error, errorId);
    }
  }

  resetError() {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      componentStack: null,
      errorId: null,
      timestamp: null,
    });
    if (this.props.onReset) {
      this.props.onReset();
    }
  }

  renderDefaultFallback() {
    const { moduleName, routeName } = this.props;
    const name = moduleName || routeName || 'Component';
    const errorMsg = this.state.error?.message || 'An unexpected error occurred while rendering this section.';

    return (
      <div
        role="alert"
        aria-live="assertive"
        data-testid="error-boundary-fallback"
        style={{
          padding: '1.25rem',
          margin: '0.75rem 0',
          borderRadius: '8px',
          border: '1px solid var(--color-border-danger, #ef5350)',
          backgroundColor: 'var(--color-bg-danger-subtle, rgba(239, 83, 80, 0.08))',
          color: 'var(--color-text, #212121)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.25rem', lineHeight: 1 }} aria-hidden="true">⚠️</span>
          <strong style={{ fontSize: '1rem', fontWeight: 600 }}>
            Unable to display {name}
          </strong>
        </div>
        <p style={{ margin: 0, fontSize: '0.875rem', opacity: 0.9 }}>
          {errorMsg}
        </p>
        {this.state.errorId && (
          <small style={{ fontSize: '0.75rem', opacity: 0.7, fontFamily: 'monospace' }}>
            Reference: {this.state.errorId}
          </small>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
          <button
            type="button"
            onClick={this.resetError}
            data-testid="error-boundary-reload-btn"
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: '1px solid var(--color-primary, #1976d2)',
              backgroundColor: 'var(--color-primary, #1976d2)',
              color: '#ffffff',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
          >
            Reload {name}
          </button>
        </div>
      </div>
    );
  }

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;

      if (!fallback) {
        return this.renderDefaultFallback();
      }

      if (typeof fallback === 'function') {
        // May be a component class/function or a render prop
        const FallbackComponent = fallback;
        const fallbackProps = {
          error: this.state.error,
          componentStack: this.state.componentStack,
          errorInfo: this.state.errorInfo,
          errorId: this.state.errorId,
          timestamp: this.state.timestamp,
          severity: this.state.severity,
          routeName: this.props.routeName || this.props.moduleName,
          moduleName: this.props.moduleName || this.props.routeName,
          resetError: this.resetError,
        };

        // If it's a class or function component, instantiate it; otherwise call it
        try {
          if (FallbackComponent.prototype && FallbackComponent.prototype.isReactComponent) {
            return <FallbackComponent {...fallbackProps} />;
          }
          return FallbackComponent(fallbackProps);
        } catch {
          return <FallbackComponent {...fallbackProps} />;
        }
      }

      // If a pre-rendered React element was passed as fallback
      return fallback;
    }

    return this.props.children;
  }
}

/**
 * Higher-Order Component to wrap any component in an ErrorBoundary
 *
 * @param {React.ComponentType} Component - Target component to wrap
 * @param {Object} options - Error boundary props (moduleName, fallback, onError, etc.)
 */
export function withErrorBoundary(ComponentToWrap, options = {}) {
  const displayName = ComponentToWrap.displayName || ComponentToWrap.name || 'Component';
  function WrappedWithErrorBoundary(props) {
    return (
      <ErrorBoundary moduleName={options.moduleName || displayName} {...options}>
        <ComponentToWrap {...props} />
      </ErrorBoundary>
    );
  }
  WrappedWithErrorBoundary.displayName = `WithErrorBoundary(${displayName})`;
  return WrappedWithErrorBoundary;
}
