import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A function that keeps its identity across renders but always calls the latest callback,
 * so that memoized components receiving it do not re-render when the callback's inputs change.
 * Like an effect event, it must not be called during rendering.
 */
export function useStableCallback<A extends unknown[], R>(
  callback: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(callback);

  useLayoutEffect(() => {
    latest.current = callback;
  });

  return useCallback((...args: A) => latest.current(...args), []);
}
