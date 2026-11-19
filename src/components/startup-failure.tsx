import { createRoot } from "react-dom/client";

import { CenteredPage } from "@/components/centered-page";
import { DataSection } from "@/components/data-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { errorMessage } from "@/lib/utils";

export function renderStartupFailure(container: HTMLElement, error: unknown) {
  createRoot(container).render(
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
