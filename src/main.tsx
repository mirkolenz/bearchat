// Temporal for browsers without native support, before anything uses it
import "temporal-polyfill/global";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast, Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/utils";
import "@/index.css";

// Ask the browser not to evict the chat history under storage pressure.
void navigator.storage.persist();

// Writes such as saving a chat run in the background, so their failures are reported here.
window.addEventListener("unhandledrejection", (event) =>
  toast.add({
    type: "error",
    title: "Something went wrong",
    description: errorMessage(event.reason),
  }),
);

const root = document.getElementById("root");

if (root) {
  try {
    // Loaded dynamically so that an invalid config.json is reported instead of leaving a blank page.
    // Importing the config alongside requests it while the app's modules are still downloading.
    const [{ App, start }] = await Promise.all([import("@/App"), import("@/lib/config")]);
    const startup = await start();
    createRoot(root).render(
      <StrictMode>
        <TooltipProvider>
          <Toaster>
            <App startup={startup} />
          </Toaster>
        </TooltipProvider>
      </StrictMode>,
    );
  } catch (error) {
    createRoot(root).render(
      <main className="flex min-h-svh items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>BearChat failed to start</AlertTitle>
          <AlertDescription className="whitespace-pre-line">{errorMessage(error)}</AlertDescription>
        </Alert>
      </main>,
    );
  }
}
