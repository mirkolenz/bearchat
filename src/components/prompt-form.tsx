import { type FileUIPart, isFileUIPart, isTextUIPart } from "ai";
import {
  ArrowUpIcon,
  DatabaseIcon,
  MicIcon,
  PaperclipIcon,
  SquareIcon,
  SquareSlashIcon,
} from "lucide-react";
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useRef, useState } from "react";

import { Attachments } from "@/components/chat-message";
import { ModelPicker, ModePicker, ReasoningPicker } from "@/components/chat-settings";
import { Hint } from "@/components/hint";
import { McpPicker, promptEntries, resourceEntries } from "@/components/mcp-picker";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { readAttachment } from "@/lib/attachments";
import type { Model } from "@/lib/connection";
import { lockedSettings, type ResolvedSettings, type Settings } from "@/lib/settings";
import { useDictation } from "@/lib/speech";
import { enabledServers, type PromptMessages } from "@/lib/mcp";
import { compactNumber } from "@/lib/utils";

interface PromptFormProps {
  busy: boolean;
  models: Model[];
  settings: ResolvedSettings;
  // tokens of the last exchange, compared against the model's context length
  contextUsed?: number;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onSubmit: (text: string, files: FileUIPart[]) => void;
  // messages of an MCP prompt that precede the user's own turn
  onInsertMessages: (messages: PromptMessages) => void;
  onStop: () => void;
}

export function PromptForm({
  busy,
  models,
  settings,
  contextUsed,
  onSettingsChange,
  onSubmit,
  onInsertMessages,
  onStop,
}: PromptFormProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileUIPart[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const dictation = useDictation((spoken) =>
    setText((current) => [current, spoken].filter(Boolean).join(" ")),
  );
  const contextLength = models.find((model) => model.id === settings.model)?.contextLength;
  const servers = enabledServers(settings);
  const hasServers = servers.length > 0;
  const [picker, setPicker] = useState<"resources" | "prompts">();

  // The prompt's last user message becomes the draft, so it can be edited before sending.
  const insertPrompt = (messages: PromptMessages) => {
    const draft = messages.at(-1)?.role === "user" ? messages.at(-1) : undefined;
    const earlier = draft ? messages.slice(0, -1) : messages;

    if (earlier.length > 0) {
      onInsertMessages(earlier);
    }

    if (draft) {
      setText(
        draft.parts
          .filter(isTextUIPart)
          .map((part) => part.text)
          .join("\n\n"),
      );
      setFiles((current) => [...current, ...draft.parts.filter(isFileUIPart)]);
    }
  };

  const addFiles = async (selected: FileList | null) => {
    const parts = await Promise.all(Array.from(selected ?? []).map(readAttachment));
    setFiles((current) => [...current, ...parts]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (busy || (!text.trim() && files.length === 0)) {
      return;
    }

    onSubmit(text, files);
    setText("");
    setFiles([]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // a slash in an empty message opens the prompts of the MCP servers
    if (event.key === "/" && text === "" && hasServers) {
      event.preventDefault();
      setPicker("prompts");
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      void addFiles(event.clipboardData.files);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-3xl px-4 pb-4">
      <InputGroup>
        {files.length > 0 && (
          <InputGroupAddon align="block-start">
            <Attachments
              files={files}
              onRemove={(index) => setFiles((current) => current.filter((_, i) => i !== index))}
            />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          autoFocus
          aria-label="Message"
          placeholder="Send a message"
          className="max-h-64"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <InputGroupAddon align="block-end">
          <Hint label="Attach files">
            <InputGroupButton size="icon-xs" onClick={() => fileInput.current?.click()}>
              <PaperclipIcon />
            </InputGroupButton>
          </Hint>
          {hasServers && (
            <>
              <McpPicker
                label="MCP resources"
                icon={<DatabaseIcon />}
                open={picker === "resources"}
                onOpenChange={(open) => setPicker(open ? "resources" : undefined)}
                load={() => resourceEntries(servers)}
                onPick={(parts) => setFiles((current) => [...current, ...parts])}
              />
              <McpPicker
                label="MCP prompts"
                icon={<SquareSlashIcon />}
                open={picker === "prompts"}
                onOpenChange={(open) => setPicker(open ? "prompts" : undefined)}
                load={() => promptEntries(servers)}
                onPick={insertPrompt}
              />
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {dictation.supported && (
            <Hint label={dictation.listening ? "Stop dictation" : "Dictate"}>
              <InputGroupButton
                size="icon-xs"
                variant={dictation.listening ? "secondary" : "ghost"}
                aria-pressed={dictation.listening}
                onClick={() => void dictation.toggle()}
              >
                <MicIcon />
              </InputGroupButton>
            </Hint>
          )}
          {hasServers && !lockedSettings.has("mode") && (
            <ModePicker value={settings.mode} onChange={(mode) => onSettingsChange({ mode })} />
          )}
          {!lockedSettings.has("reasoning") && (
            <ReasoningPicker
              value={settings.reasoning}
              onChange={(reasoning) => onSettingsChange({ reasoning })}
            />
          )}
          {!lockedSettings.has("model") && (
            <ModelPicker
              value={settings.model}
              models={models}
              onChange={(model) => onSettingsChange({ model })}
            />
          )}
          <span className="ml-auto" />
          {contextLength !== undefined && contextUsed !== undefined && (
            <Hint label="Context used">
              <InputGroupText className="text-xs tabular-nums">
                {compactNumber.format(contextUsed)} / {compactNumber.format(contextLength)}
              </InputGroupText>
            </Hint>
          )}
          <InputGroupButton
            size="icon-sm"
            variant="default"
            aria-label={busy ? "Stop" : "Send"}
            type={busy ? "button" : "submit"}
            onClick={busy ? onStop : undefined}
          >
            {busy ? <SquareIcon /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
