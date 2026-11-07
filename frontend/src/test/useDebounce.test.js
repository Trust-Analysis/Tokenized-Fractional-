/**
 * useDebounce Hook Tests
 *
 * Tests for the debounce functionality to ensure that rapid input changes
 * result in a single callback execution after the debounce window, preventing
 * redundant RPC calls or expensive operations.
 */

import { renderHook, act } from '@testing-library/react';
import { useDebounce, useDebouncedCallback } from '../hooks/useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 300));
    expect(result.current).toBe('initial');
  });

  it('should update the debounced value after the delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    );

    expect(result.current).toBe('initial');

    // Update the value
    rerender({ value: 'updated', delay: 300 });

    // Should still be the old value before the delay
    expect(result.current).toBe('initial');

    // Fast-forward time by the delay
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Now the debounced value should be updated
    expect(result.current).toBe('updated');
  });

  it('should reset the timer if the value changes before the delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    );

    expect(result.current).toBe('initial');

    // First update
    rerender({ value: 'first', delay: 300 });

    // Advance time by 200ms (less than the 300ms delay)
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // Should still be the initial value
    expect(result.current).toBe('initial');

    // Second update before the first delay completes
    rerender({ value: 'second', delay: 300 });

    // Advance time by another 200ms (total 400ms, but timer was reset)
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // Should still be the initial value because the timer was reset
    expect(result.current).toBe('initial');

    // Advance time by the remaining 100ms to complete the second delay
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Now the debounced value should be the second value
    expect(result.current).toBe('second');
  });

  it('should clear the timeout on unmount', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const { unmount } = renderHook(() => useDebounce('test', 300));

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not call the callback immediately', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current('arg1');
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should call the callback after the delay', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current('arg1');
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('arg1');
  });

  it('should reset the timer if called again before the delay', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current('first');
    });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(callback).not.toHaveBeenCalled();

    // Call again before the delay completes
    act(() => {
      result.current('second');
    });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    // Still should not have been called because the timer was reset
    expect(callback).not.toHaveBeenCalled();

    // Advance time by the remaining 100ms
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Now it should be called with the latest arguments
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('second');
  });

  it('should handle rapid successive calls with only the last one executing', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    // Simulate rapid typing
    act(() => {
      result.current('1');
      result.current('2');
      result.current('3');
      result.current('4');
      result.current('5');
    });

    expect(callback).not.toHaveBeenCalled();

    // Advance time past the debounce delay
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Should only be called once with the last value
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('5');
  });

  it('should pass multiple arguments correctly', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current('arg1', 'arg2', 'arg3');
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
  });

  it('should use the latest callback if it changes', () => {
    const callback1 = jest.fn();
    const callback2 = jest.fn();
    const { result, rerender } = renderHook(
      ({ cb }) => useDebouncedCallback(cb, 300),
      { initialProps: { cb: callback1 } }
    );

    act(() => {
      result.current('test');
    });

    // Change the callback
    rerender({ cb: callback2 });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Should call the latest callback
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledWith('test');
  });

  it('should clear the timeout on unmount', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const callback = jest.fn();
    const { unmount } = renderHook(() => useDebouncedCallback(callback, 300));

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('should work with the configured 400ms delay from the implementation', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 400));

    act(() => {
      result.current('test');
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('Debounce Integration Test - RPC Call Prevention', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should prevent multiple RPC calls during rapid input changes', () => {
    // Simulate an RPC call function
    const mockRpcCall = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(mockRpcCall, 400));

    // Simulate a user typing "12345" rapidly (5 keystrokes in quick succession)
    act(() => {
      result.current('1');
      result.current('12');
      result.current('123');
      result.current('1234');
      result.current('12345');
    });

    // Should not have called the RPC function yet
    expect(mockRpcCall).not.toHaveBeenCalled();

    // Advance time by 400ms (the debounce delay)
    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Should have called the RPC function exactly once with the final value
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall).toHaveBeenCalledWith('12345');
  });

  it('should allow RPC call after user stops typing for the debounce period', () => {
    const mockRpcCall = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(mockRpcCall, 400));

    // User types "1"
    act(() => {
      result.current('1');
    });

    // User waits 500ms (longer than debounce delay)
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Should have called with "1"
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall).toHaveBeenCalledWith('1');

    // User types "2"
    act(() => {
      result.current('2');
    });

    // User waits another 500ms
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Should have called again with "2"
    expect(mockRpcCall).toHaveBeenCalledTimes(2);
    expect(mockRpcCall).toHaveBeenLastCalledWith('2');
  });
});
