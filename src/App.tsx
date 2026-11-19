import { useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { Thread } from "@/components/chat";
import { InputRequestDialog } from "@/components/input-request-dialog";
import { Login } from "@/components/login";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { config } from "@/lib/config";
import { type Session, resumeSession, signOut } from "@/lib/connection";
import type { Thread as ThreadData } from "@/lib/db";
import { listThreads } from "@/lib/threads";
import { startRouting, usePage } from "@/lib/route";

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

function Workspace({ session, threads, onSignOut }: WorkspaceProps) {
  const { route, thread } = usePage();

  return (
    <SidebarProvider>
      <AppSidebar activeId={route.id} initialThreads={threads} onSignOut={onSignOut} />
      <SidebarInset className="h-svh">
        <header className="flex h-12 shrink-0 items-center px-2">
          <SidebarTrigger />
        </header>
        <Thread key={route.id} route={route} thread={thread} session={session} />
      </SidebarInset>
      <InputRequestDialog />
    </SidebarProvider>
  );
}
