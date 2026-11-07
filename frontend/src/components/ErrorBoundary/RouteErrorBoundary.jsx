import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import ErrorFallback from '../ErrorFallback/ErrorFallback';

/**
 * RouteErrorBoundary — Error boundary aware of React Router.
 *
 * Wraps a route component and automatically:
 *   - Captures the route name
 *   - Implements route-aware error recovery (retry on same route)
 *   - Passes navigation context to error boundary
 *
 * Usage:
 *   <RouteErrorBoundary routeName="Marketplace">
 *     <MarketplacePage />
 *   </RouteErrorBoundary>
 */
function RouteErrorBoundaryWrapper({ routeName, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [resetKey, setResetKey] = React.useState(0);

  const handleReset = () => {
    // Force re-render by resetting key, which resets the error boundary
    setResetKey((prev) => prev + 1);
  };

  return (
    <ErrorBoundary
      key={resetKey}
      routeName={routeName}
      fallback={(props) => <ErrorFallbackWithNavigation {...props} routeName={routeName} onReset={handleReset} />}
      onError={(error, errorId) => {
        // Optional: log route context
        console.log(`[${routeName}] Error caught:`, { errorId, route: location.pathname });
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Enhanced ErrorFallback with navigation-aware retry logic.
 */
function ErrorFallbackWithNavigation({
  error,
  errorInfo,
  componentStack,
  errorId,
  timestamp,
  severity,
  routeName,
  resetError,
  onReset,
}) {
  const navigate = useNavigate();

  const handleTryAgain = () => {
    resetError();
    onReset();
    // Optionally refresh the page or re-fetch data
    window.location.reload();
  };

  const handleGoHome = () => {
    resetError();
    navigate('/');
  };

  return (
    <ErrorFallback
      error={error}
      errorInfo={errorInfo}
      componentStack={componentStack}
      errorId={errorId}
      timestamp={timestamp}
      severity={severity}
      routeName={routeName}
      resetError={handleTryAgain}
      onGoHome={handleGoHome}
    />
  );
}

export default RouteErrorBoundaryWrapper;
