import { SquarePenIcon } from "lucide-react";
import { useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { Thread } from "@/components/chat";
import { Hint } from "@/components/hint";
import { InputRequestDialog } from "@/components/input-request-dialog";
import { Login } from "@/components/login";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { config } from "@/lib/config";
import { type Session, resumeSession, signOut } from "@/lib/connection";
import type { Thread as ThreadData } from "@/lib/db";
import { listThreads } from "@/lib/threads";
import { openThread, startRouting, usePage } from "@/lib/route";

interface Startup {
  session?: Session;
  error?: string;
  threads: ThreadData[];
}

/** Loads everything the first render needs in parallel, so the app renders once without fallbacks. */
export async function start(): Promise<Startup> {
  const [resumed, threads] = await Promise.all([resumeSession(), listThreads(), startRouting()]);
  return { ...resumed, threads };
}

export function App({ startup }: { startup: Startup }) {
  const [session, setSession] = useState(startup.session);

  return (
    <>
      <title>{config.title}</title>
      {session === undefined ? (
        <Login error={startup.error} onSignIn={setSession} />
      ) : (
        <Workspace
          session={session}
          threads={startup.threads}
          onSignOut={() => void signOut().then(() => setSession(undefined))}
        />
      )}
    </>
  );
}

interface WorkspaceProps {
  session: Session;
  threads: ThreadData[];
  onSignOut: () => void;
}

// whether the docked sidebar is open, the overlay on small screens always starts closed
const sidebarKey = "bearchat:sidebar";

function Workspace({ session, threads, onSignOut }: WorkspaceProps) {
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
      <AppSidebar activeId={route.id} initialThreads={threads} onSignOut={onSignOut} />
      <SidebarInset className="min-h-0 min-w-0 px-safe-0">
        <Header />
        <Thread key={route.id} route={route} thread={thread} session={session} />
      </SidebarInset>
      <InputRequestDialog />
    </SidebarProvider>
  );
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
