import { SquarePenIcon } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AppSidebar } from "@/components/app-sidebar";
import { Thread } from "@/components/chat";
import { Hint } from "@/components/hint";
import { InputRequestDialog } from "@/components/input-request-dialog";
import { Login } from "@/components/login";
import { Toaster } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { config } from "@/lib/config";
import { canSignOut, type Session } from "@/lib/connection";
import { openThread, type Route, usePage } from "@/lib/route";
import { useUserSettings } from "@/lib/settings";
import { useThreads } from "@/lib/threads";
import { preloadTools } from "@/lib/tools";
import { errorMessage } from "@/lib/utils";
import type { Startup } from "@/start";

export function renderApp(container: HTMLElement, startup: Startup) {
  // Writes such as saving a chat run in the background, so their failures are reported here.
  window.addEventListener("unhandledrejection", (event) =>
    toast.add({
      type: "error",
      title: "Something went wrong",
      description: errorMessage(event.reason),
    }),
  );
  createRoot(container).render(
    <StrictMode>
      <TooltipProvider>
        <Toaster>
          <App startup={startup} />
        </Toaster>
      </TooltipProvider>
    </StrictMode>,
  );
}

function App({ startup }: { startup: Startup }) {
  const [session, setSession] = useState(startup.session);
  const settings = useUserSettings();

  // loads during sign-in and while the first message is written
  useEffect(() => preloadTools(settings), [settings]);

  return (
    <>
      <title>{config.title}</title>
      {session === undefined ? (
        <Login error={startup.error} onSignIn={setSession} />
      ) : (
        <Workspace session={session} />
      )}
    </>
  );
}

// whether the docked sidebar is open, the overlay on small screens always starts closed
const sidebarKey = "bearchat:sidebar";

function Workspace({ session }: { session: Session }) {
  const { route, thread } = usePage();
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(sidebarKey) !== "false",
  );

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={(open) => {
        setSidebarOpen(open);
        localStorage.setItem(sidebarKey, String(open));
      }}
      className="h-(--viewport-height) min-h-0"
    >
      <AppSidebar canSignOut={canSignOut(session.connection)} />
      <SidebarInset className="min-h-0 min-w-0 px-safe-0">
        <Header />
        <Thread key={route.id} route={route} thread={thread} session={session} />
      </SidebarInset>
      <InputRequestDialog />
      <DocumentTitle route={route} />
    </SidebarProvider>
  );
}

/** Names the browser tab after the shown chat, separately so that chat list changes do not re-render the chat. */
function DocumentTitle({ route }: { route: Route }) {
  // new and temporary chats are not listed
  const title = useThreads().find((thread) => thread.id === route.id)?.title;

  useEffect(() => {
    document.title = title === undefined ? config.title : `${title} · ${config.title}`;
  }, [title]);

  return null;
}

function Header() {
  const { isMobile, open } = useSidebar();

  return (
    <header className="box-content flex h-12 shrink-0 items-center gap-1 px-2 pt-safe-0">
      <SidebarTrigger />
      {/* the sidebar with its new chat button is hidden */}
      {(isMobile || !open) && (
        <Hint label="New chat">
          <Button variant="ghost" size="icon-sm" onClick={() => openThread()}>
            <SquarePenIcon />
          </Button>
        </Hint>
      )}
    </header>
  );
}
