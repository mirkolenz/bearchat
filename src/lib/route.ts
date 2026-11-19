import { useSyncExternalStore } from "react";

import { type LoadedThread, loadThread } from "@/lib/threads";

// The active chat lives in the query string, which static file servers ignore.
export interface Route {
  id: string;
  // temporary chats are never saved
  temporary: boolean;
}

// A route is only shown once its chat is loaded, so rendering never waits for data.
export interface Page {
  route: Route;
  thread: LoadedThread;
}

let current: Page | undefined;
const listeners = new Set<() => void>();
// new chats have nothing to load, so they are shown at once
const newThread: LoadedThread = { messages: [], exists: false, settings: {}, skipped: 0 };

function routeURL(route: Route): string {
  const url = new URL(location.href);
  url.search = new URLSearchParams(
    route.temporary ? { chat: route.id, temporary: "" } : { chat: route.id },
  ).toString();
  return url.href;
}

function parseRoute(href: string): Route | undefined {
  const params = new URL(href).searchParams;
  const id = params.get("chat");
  return id === null ? undefined : { id, temporary: params.has("temporary") };
}

function publish(page: Page) {
  current = page;
  listeners.forEach((listener) => listener());
}

async function show(route: Route, signal?: AbortSignal) {
  const thread = await loadThread(route.id);

  // a later navigation replaced this one while the chat was loading
  if (signal?.aborted) {
    return;
  }

  publish({ route, thread });
}

// the navigation info marks routes of new chats
function navigate(route: Route, history: NavigationHistoryBehavior = "push", isNew = false) {
  navigation.navigate(routeURL(route), { history, info: isNew });
}

export function openThread(id?: string) {
  navigate({ id: id ?? crypto.randomUUID(), temporary: false }, "push", id === undefined);
}

export function openTemporaryThread() {
  navigate({ id: crypto.randomUUID(), temporary: true }, "push", true);
}

/** Shows the chat of the current URL, starting a new one if there is none, and follows later navigations. */
export async function startRouting(): Promise<void> {
  let route = parseRoute(location.href);

  if (route === undefined) {
    route = { id: crypto.randomUUID(), temporary: false };
    history.replaceState(null, "", routeURL(route));
    publish({ route, thread: newThread });
  } else {
    await show(route);
  }

  // Navigations within the app only change the query string, so they stay in the page.
  navigation.addEventListener("navigate", (event) => {
    const destination = new URL(event.destination.url);

    if (
      !event.canIntercept ||
      event.downloadRequest !== null ||
      destination.origin !== location.origin ||
      destination.pathname !== location.pathname
    ) {
      return;
    }

    event.intercept({
      handler: async () => {
        const next = parseRoute(destination.href);

        if (next === undefined) {
          navigate({ id: crypto.randomUUID(), temporary: false }, "replace", true);
        } else if (event.info === true) {
          publish({ route: next, thread: newThread });
        } else {
          await show(next, event.signal);
        }
      },
    });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePage(): Page {
  const page = useSyncExternalStore(subscribe, () => current);

  if (page === undefined) {
    throw new Error("The page is rendered before routing started");
  }

  return page;
}
