import { useSyncExternalStore } from "react";

/** A value outside of React, which components re-render with whenever it is replaced. */
export interface Store<T> {
  get: () => T;
  set: (value: T) => void;
  // calls the listener after every change, until the returned function is called
  subscribe: (listener: () => void) => () => void;
  useValue: () => T;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const get = () => value;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    get,
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe,
    useValue: () => useSyncExternalStore(subscribe, get),
  };
}
