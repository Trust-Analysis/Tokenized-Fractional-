import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useDebounce — Custom hook for debouncing values with configurable delay.
 *
 * This hook is designed to prevent rapid successive calls (e.g., RPC calls)
 * that could be triggered by user input like typing in a number field.
 *
 * @param {any} value - The value to debounce
 * @param {number} delay - The debounce delay in milliseconds (default: 300ms)
 * @returns {any} - The debounced value
 *
 * Usage:
 *   const [searchTerm, setSearchTerm] = useState('');
 *   const debouncedSearchTerm = useDebounce(searchTerm, 500);
 *   useEffect(() => {
 *     // Only runs after 500ms of no changes to searchTerm
 *     performSearch(debouncedSearchTerm);
 *   }, [debouncedSearchTerm]);
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timeoutRef = useRef(null);

  useEffect(() => {
    // Clear the previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set a new timeout to update the debounced value
    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup function to clear timeout on unmount or value change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * useDebouncedCallback — Custom hook for debouncing callback functions.
 *
 * This hook is useful when you need to debounce the execution of a function
 * rather than just a value. It returns a debounced version of the callback.
 *
 * @param {Function} callback - The function to debounce
 * @param {number} delay - The debounce delay in milliseconds (default: 300ms)
 * @returns {Function} - The debounced callback function
 *
 * Usage:
 *   const handleChange = useDebouncedCallback((value) => {
 *     // Only runs after 300ms of no changes
 *     performExpensiveOperation(value);
 *   }, 300);
 *
 *   <input onChange={(e) => handleChange(e.target.value)} />
 */
export function useDebouncedCallback(callback, delay = 300) {
  const timeoutRef = useRef(null);
  const latestCallbackRef = useRef(callback);
  const latestArgsRef = useRef([]);

  // Always keep the callback ref up to date
  useEffect(() => {
    latestCallbackRef.current = callback;
  }, [callback]);

  const debouncedCallback = useCallback(
    (...args) => {
      // Store the latest arguments
      latestArgsRef.current = args;

      // Clear the previous timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set a new timeout to execute the callback
      timeoutRef.current = setTimeout(() => {
        latestCallbackRef.current(...latestArgsRef.current);
      }, delay);
    },
    [delay]
  );

  // Cleanup function to clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

export default useDebounce;
