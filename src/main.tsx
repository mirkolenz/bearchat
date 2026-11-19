// Temporal for browsers without native support, before anything uses it
import "temporal-polyfill/global";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Toaster } from "@/components/toaster";
import { toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/utils";
import "@/lib/viewport";
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
    // loaded only here, so a normal start does not download them
    const [{ CenteredPage }, { DataSection }, { FieldGroup }] = await Promise.all([
      import("@/components/centered-page"),
      import("@/components/data-section"),
      import("@/components/ui/field"),
    ]);
    createRoot(root).render(
      <CenteredPage>
        <FieldGroup>
          <Alert variant="destructive">
            <AlertTitle>BearChat failed to start</AlertTitle>
            <AlertDescription className="whitespace-pre-line wrap-anywhere">
              {errorMessage(error)}
            </AlertDescription>
          </Alert>
          {/* stored data can cause the failure, so it can be saved and reset from here */}
          <DataSection />
        </FieldGroup>
      </CenteredPage>,
    );
  }
}
