import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary, { withErrorBoundary } from '../components/ErrorBoundary/ErrorBoundary';

function BuggyComponent({ shouldThrow }) {
  if (shouldThrow) {
    throw new Error('Explosion in module');
  }
  return <div>Component is functioning normally</div>;
}

function StatefulBuggy({ failFirst }) {
  const [hasFailed, setHasFailed] = useState(failFirst);

  if (hasFailed) {
    throw new Error('Test explosion');
  }

  return <div>Recovered Component State</div>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    // Suppress React error boundary console error output during test
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary moduleName="Test Module">
        <BuggyComponent shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Component is functioning normally')).toBeInTheDocument();
  });

  it('catches render errors and renders default fallback UI with module name', () => {
    render(
      <ErrorBoundary moduleName="Marketplace Dashboard">
        <BuggyComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByText(/Unable to display Marketplace Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Explosion in module/i)).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-reload-btn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload Marketplace Dashboard/i })).toBeInTheDocument();
  });

  it('allows user to reload the specific failing component', () => {
    let throwError = true;
    const onReset = vi.fn();

    function Flaky() {
      if (throwError) {
        throw new Error('Transient error');
      }
      return <div>Flaky Component Working</div>;
    }

    const { rerender } = render(
      <ErrorBoundary moduleName="Flaky Module" onReset={onReset}>
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Unable to display Flaky Module/i)).toBeInTheDocument();

    // Fix the error before reload
    throwError = false;

    // Click the reload button
    fireEvent.click(screen.getByTestId('error-boundary-reload-btn'));

    expect(onReset).toHaveBeenCalled();
    expect(screen.getByText('Flaky Component Working')).toBeInTheDocument();
  });

  it('renders custom fallback when provided as component', () => {
    function CustomFallback({ error, resetError, moduleName }) {
      return (
        <div>
          <span>Custom error for {moduleName}: {error.message}</span>
          <button onClick={resetError}>Retry</button>
        </div>
      );
    }

    render(
      <ErrorBoundary moduleName="Custom Section" fallback={CustomFallback}>
        <BuggyComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Custom error for Custom Section: Explosion in module/i)).toBeInTheDocument();
  });

  it('supports withErrorBoundary HOC', () => {
    const Wrapped = withErrorBoundary(BuggyComponent, { moduleName: 'HOC Wrapped' });

    render(<Wrapped shouldThrow={true} />);

    expect(screen.getByText(/Unable to display HOC Wrapped/i)).toBeInTheDocument();
  });
});
