import { DownloadIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { z } from "zod";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { exportThreads, importThreads } from "@/lib/threads";
import {
  mcpServerNameSchema,
  mcpServerURLSchema,
  type SettingKey,
  settingsSchema,
} from "@/lib/schemas";
import {
  lockedSettings,
  resetUserSettings,
  type Settings,
  updateUserSettings,
  useUserSettings,
} from "@/lib/settings";
import { cn, downloadFile, errorMessage, jsonSchema } from "@/lib/utils";

const tools = [
  {
    key: "pythonTool",
    label: "Python",
    description: "Runs code in a sandbox inside the browser, which can read the browser files.",
  },
  {
    key: "fileTools",
    label: "Browser files",
    description: "Reads, writes and edits the files shown in the Files tab, including its images.",
  },
  {
    key: "chatTools",
    label: "Chat history",
    description: "Searches and reads your other saved chats.",
  },
] as const satisfies { key: SettingKey; label: string; description: string }[];

const requestBodySchema = jsonSchema.pipe(settingsSchema.shape.requestBody);

/** A text field that only saves values that pass its schema. */
function useValidatedText<T>(initial: string, schema: z.ZodType<T>, save: (value: T) => void) {
  const [text, setText] = useState(initial);
  const result = schema.safeParse(text);

  const change = (next: string) => {
    setText(next);
    const parsed = schema.safeParse(next);

    if (parsed.success) {
      save(parsed.data);
    }
  };

  return { text, change, error: result.success ? undefined : result.error.issues[0]?.message };
}

type McpServers = Settings["mcpServers"];

/** The message of the first issue, only once something was entered. */
function issue(schema: z.ZodType, text: string): string | undefined {
  const result = schema.safeParse(text);
  return text === "" || result.success ? undefined : result.error.issues[0]?.message;
}

/** One row per server with a toggle, plus fields that add a server under a new name. */
function McpServerList({
  servers,
  onChange,
}: {
  servers: McpServers;
  onChange: (servers: McpServers) => void;
}) {
  const [name, setName] = useState("");
  const [url, setURL] = useState("");
  const entry = { name: name.trim(), url: url.trim() };
  const error =
    issue(mcpServerNameSchema, entry.name) ??
    (Object.hasOwn(servers, entry.name) ? "This name is already used" : undefined) ??
    issue(mcpServerURLSchema, entry.url);
  const addable = error === undefined && entry.name !== "" && entry.url !== "";

  const add = () => {
    if (addable) {
      onChange({ ...servers, [entry.name]: { url: entry.url, enabled: true } });
      setName("");
      setURL("");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  };

  return (
    <>
      {Object.keys(servers).length > 0 && (
        <ItemGroup className="gap-2">
          {Object.entries(servers).map(([key, server]) => (
            <Item key={key} variant="outline" size="xs">
              <ItemContent className="min-w-0">
                <ItemTitle>{key}</ItemTitle>
                <ItemDescription className="truncate font-mono text-xs">
                  {server.url}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  aria-label={`Enable ${key}`}
                  checked={server.enabled}
                  onCheckedChange={(enabled) =>
                    onChange({ ...servers, [key]: { ...server, enabled } })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${key}`}
                  onClick={() =>
                    onChange(
                      Object.fromEntries(
                        Object.entries(servers).filter(([other]) => other !== key),
                      ),
                    )
                  }
                >
                  <XIcon />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <ButtonGroup className="w-full">
        <Input
          id="mcp-servers"
          aria-label="Server name"
          className="max-w-28"
          placeholder="docs"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Input
          aria-label="Server URL"
          className="font-mono text-xs"
          placeholder="https://example.org/mcp"
          value={url}
          onChange={(event) => setURL(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Add server"
          disabled={!addable}
          onClick={add}
        >
          <PlusIcon />
        </Button>
      </ButtonGroup>
      <FieldError>{error}</FieldError>
    </>
  );
}

function ChatData() {
  const importInput = useRef<HTMLInputElement>(null);

  const download = async () => {
    const backup = await exportThreads();
    downloadFile(
      `bearchat-${Temporal.Now.plainDateISO().toString()}.json`,
      JSON.stringify(backup),
      "application/json",
    );
  };

  const upload = async (file: File) => {
    try {
      const count = await importThreads(jsonSchema.parse(await file.text()));
      toast.add({ type: "success", title: `Imported ${count} chats` });
    } catch (error) {
      toast.add({ type: "error", title: "Import failed", description: errorMessage(error) });
    }
  };

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>Chats</FieldLabel>
        <FieldDescription>Exports and imports all chats with their attachments.</FieldDescription>
      </FieldContent>
      <Button variant="outline" size="sm" onClick={() => void download()}>
        <DownloadIcon />
        Export
      </Button>
      <Button variant="outline" size="sm" onClick={() => importInput.current?.click()}>
        <UploadIcon />
        Import
      </Button>
      <input
        ref={importInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            void upload(file);
          }

          event.target.value = "";
        }}
      />
    </Field>
  );
}

/** Remounted on reset, so text fields drop their drafts. */
function SettingsFields() {
  const settings = useUserSettings();
  const body = useValidatedText(
    JSON.stringify(settings.requestBody, null, 2),
    requestBodySchema,
    (requestBody) => updateUserSettings({ requestBody }),
  );

  return (
    <FieldGroup>
      {tools
        .filter((tool) => !lockedSettings.has(tool.key))
        .map((tool) => (
          <Field key={tool.key} orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={tool.key}>{tool.label}</FieldLabel>
              <FieldDescription>{tool.description}</FieldDescription>
            </FieldContent>
            <Switch
              id={tool.key}
              checked={settings[tool.key]}
              onCheckedChange={(checked) => updateUserSettings({ [tool.key]: checked })}
            />
          </Field>
        ))}
      {!lockedSettings.has("mcpServers") && (
        <Field>
          <FieldLabel htmlFor="mcp-servers">MCP servers</FieldLabel>
          <FieldDescription>
            Servers must allow cross-origin requests and need no authentication. Their tools are
            prefixed with the server name.
          </FieldDescription>
          <McpServerList
            servers={settings.mcpServers}
            onChange={(mcpServers) => updateUserSettings({ mcpServers })}
          />
        </Field>
      )}
      {!lockedSettings.has("instructions") && (
        <Field>
          <FieldLabel htmlFor="instructions">Custom instructions</FieldLabel>
          <Textarea
            id="instructions"
            className="max-h-48"
            value={settings.instructions}
            onChange={(event) => updateUserSettings({ instructions: event.target.value })}
          />
        </Field>
      )}
      {!lockedSettings.has("requestBody") && (
        <Field data-invalid={body.error !== undefined}>
          <FieldLabel htmlFor="request-body">Request options</FieldLabel>
          <Textarea
            id="request-body"
            className="max-h-48 font-mono text-xs"
            aria-invalid={body.error !== undefined}
            value={body.text}
            onChange={(event) => body.change(event.target.value)}
          />
          <FieldDescription>
            JSON merged into every request, e.g. {'{"top_k": 20}'}.
          </FieldDescription>
          <FieldError>{body.error}</FieldError>
        </Field>
      )}
      <ChatData />
    </FieldGroup>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [generation, setGeneration] = useState(0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Saved in this browser. Model, reasoning effort and tool execution are also remembered by
            each chat.
          </DialogDescription>
        </DialogHeader>
        <SettingsFields key={generation} />
        <DialogFooter>
          <a
            href="licenses.txt"
            target="_blank"
            className={cn(buttonVariants({ variant: "link" }), "sm:mr-auto")}
          >
            Licenses
          </a>
          <Button
            variant="outline"
            onClick={() => {
              resetUserSettings();
              setGeneration((current) => current + 1);
            }}
          >
            Reset
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
