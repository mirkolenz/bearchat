import { createRoot } from "react-dom/client";

import { CenteredPage } from "@/components/centered-page";
import { DataSection } from "@/components/data-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { errorMessage } from "@/lib/utils";

export function renderStartupFailure(container: HTMLElement, error: unknown) {
  createRoot(container).render(
    // the config may be what failed to load, so its title is out of reach
    <CenteredPage title="BearChat">
      <FieldGroup>
        <Alert variant="destructive">
          <AlertTitle>Failed to start</AlertTitle>
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
