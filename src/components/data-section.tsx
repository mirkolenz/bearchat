import { DownloadIcon, RotateCcwIcon, UploadIcon } from "lucide-react";
import { startTransition, useActionState, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { useConfirm } from "@/hooks/use-confirm";
import { downloadFile, errorMessage, jsonSchema } from "@/lib/utils";

interface Status {
  message?: string;
  error?: string;
}

// The data modules are loaded on demand, so the section also works where the app failed to start.
const actions = {
  export: async () => {
    const { exportThreads } = await import("@/lib/threads");
    downloadFile(
      `bearchat-${Temporal.Now.plainDateISO().toString()}.json`,
      JSON.stringify(await exportThreads()),
      "application/json",
    );
    return undefined;
  },
  import: async (file: File) => {
    const { importThreads } = await import("@/lib/threads");
    const count = await importThreads(jsonSchema.parse(await file.text()));
    return `Imported ${count} chats`;
  },
  reset: async () => {
    await (await import("@/lib/reset")).resetApp();
    return undefined;
  },
};

/**
 * Exports, imports and resets the data in this browser, which needs no server,
 * so it is shown in the settings, on the sign-in screen, and when the app fails to start.
 */
export function DataSection() {
  const importInput = useRef<HTMLInputElement>(null);
  const [status, run, pending] = useActionState(
    async (_previous: Status, action: () => Promise<string | undefined>): Promise<Status> => {
      try {
        return { message: await action() };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
    {},
  );
  const perform = (action: () => Promise<string | undefined>) =>
    startTransition(() => run(action));
  const reset = useConfirm(() => perform(actions.reset));

  return (
    <>
      <Field orientation="responsive">
        <FieldContent>
          <FieldLabel>Chats</FieldLabel>
          <FieldDescription>Exports and imports all chats with their attachments.</FieldDescription>
        </FieldContent>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => perform(actions.export)}
          >
            <DownloadIcon />
            Export
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => importInput.current?.click()}
          >
            <UploadIcon />
            Import
          </Button>
        </div>
        <input
          ref={importInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              perform(() => actions.import(file));
            }

            event.target.value = "";
          }}
        />
      </Field>
      <Field orientation="responsive">
        <FieldContent>
          <FieldLabel>Reset</FieldLabel>
          <FieldDescription>
            Deletes all chats, files and settings in this browser and signs out.
          </FieldDescription>
        </FieldContent>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={reset.click}
        >
          <RotateCcwIcon />
          {reset.confirming ? "Confirm reset" : "Reset app"}
        </Button>
      </Field>
      {status.message && <FieldDescription>{status.message}</FieldDescription>}
      <FieldError>{status.error}</FieldError>
    </>
  );
}
