import { threadSchema } from "@/lib/schemas";
import { createStore } from "@/lib/store";
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

const page = createStore<Page | undefined>(undefined);
// the chat being opened, which the sidebar marks while it loads
const target = createStore<Route | undefined>(undefined);
// new chats have nothing to load, so they are shown at once
const newThread: LoadedThread = {
  messages: [],
  revision: undefined,
  settings: {},
  skipped: 0,
};

function routeURL(route: Route): string {
  const url = new URL(location.href);
  url.search = new URLSearchParams(
    route.temporary ? { chat: route.id, temporary: "" } : { chat: route.id },
  ).toString();
  return url.href;
}

function parseRoute(href: string): Route | undefined {
  const params = new URL(href).searchParams;
  // chats are listed only with valid ids, so any other id starts a new chat
  const id = threadSchema.shape.id.safeParse(params.get("chat"));
  return id.success ? { id: id.data, temporary: params.has("temporary") } : undefined;
}

function publish(next: Page) {
  target.set(next.route);
  page.set(next);
}

async function show(route: Route, signal: AbortSignal) {
  target.set(route);

  try {
    const thread = await loadThread(route.id);

    // a later navigation replaced this one while the chat was loading
    if (!signal.aborted) {
      publish({ route, thread });
    }
  } catch (error) {
    if (!signal.aborted) {
      target.set(page.get()?.route);
    }

    throw error;
  }
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

// The navigations that change the chat within the page, unlike reloads, which load the page again.
const inAppNavigations: ReadonlySet<NavigationType> = new Set(["push", "replace", "traverse"]);

/** Shows the chat of the current URL, starting a new one if there is none, and follows later navigations. */
export async function startRouting(): Promise<Page> {
  const route = parseRoute(location.href);
  const initial =
    route === undefined
      ? { route: { id: crypto.randomUUID(), temporary: false }, thread: newThread }
      : { route, thread: await loadThread(route.id) };

  if (route === undefined) {
    history.replaceState(null, "", routeURL(initial.route));
  }

  publish(initial);

  // Navigations within the app only change the query string, so they stay in the page.
  navigation.addEventListener("navigate", (event) => {
    const destination = new URL(event.destination.url);

    if (
      !event.canIntercept ||
      !inAppNavigations.has(event.navigationType) ||
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

  return initial;
}

export function usePage(): Page {
  const current = page.useValue();

  if (current === undefined) {
    throw new Error("The page is rendered before routing started");
  }

  return current;
}

/** The id of the chat that is shown or being opened. */
export function useTargetId(): string | undefined {
  return target.useValue()?.id;
}
