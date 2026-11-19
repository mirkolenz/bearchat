import { type FileUIPart, isFileUIPart, isTextUIPart } from "ai";
import {
  ArrowUpIcon,
  DatabaseIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  SquareSlashIcon,
} from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { Attachments } from "@/components/chat-message";
import { convertFiles } from "@/components/convert-files";
import {
  ModelPicker,
  modeOption,
  OptionPicker,
  OptionSubmenu,
  reasoningOption,
} from "@/components/chat-settings";
import { Hint } from "@/components/hint";
import { McpPicker, promptEntries, resourceEntries } from "@/components/mcp-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { storeFile } from "@/lib/blobs";
import type { Model } from "@/lib/connection";
import { enabledServers, type PromptMessages } from "@/lib/mcp";
import { hasHardwareKeyboard, isTouchScreen } from "@/lib/pointer";
import { lockedSettings, type ResolvedSettings, type Settings } from "@/lib/settings";
import { useDictation } from "@/lib/speech";
import { cn, compactNumber } from "@/lib/utils";

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
  const composer = useRef<HTMLDivElement>(null);
  const dictation = useDictation((spoken) =>
    setText((current) => [current, spoken].filter(Boolean).join(" ")),
  );
  const contextLength = models.find((model) => model.id === settings.model)?.contextLength;
  const servers = enabledServers(settings);
  const hasServers = servers.length > 0;
  const [picker, setPicker] = useState<"resources" | "prompts">();
  const showMode = hasServers && !lockedSettings.has("mode");
  const showReasoning = !lockedSettings.has("reasoning");
  const context =
    contextLength !== undefined && contextUsed !== undefined
      ? `${compactNumber.format(contextUsed)} / ${compactNumber.format(contextLength)}`
      : undefined;

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
    const parts = await Promise.all((await convertFiles(selected ?? [])).map(storeFile));
    setFiles((current) => [...current, ...parts]);
  };

  // Files dropped anywhere in the window are attached, instead of the browser leaving the app to open them.
  const drop = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    void addFiles(event.dataTransfer?.files ?? null);
  });

  useEffect(() => {
    const allow = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    };
    const handle = (event: DragEvent) => drop(event);
    window.addEventListener("dragover", allow);
    window.addEventListener("drop", handle);
    return () => {
      window.removeEventListener("dragover", allow);
      window.removeEventListener("drop", handle);
    };
  }, []);

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
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      // on-screen keyboards have no Shift+Enter, so their Enter starts a new line
      (event.metaKey || event.ctrlKey || hasHardwareKeyboard())
    ) {
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
    <form
      onSubmit={submit}
      className="mx-auto w-full max-w-3xl px-4 pb-safe-4"
    >
      <InputGroup ref={composer}>
        {files.length > 0 && (
          <InputGroupAddon align="block-start">
            <Attachments
              files={files}
              onRemove={(index) => setFiles((current) => current.filter((_, i) => i !== index))}
            />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          // the on-screen keyboard would cover half of the screen right away
          autoFocus={!isTouchScreen()}
          aria-label="Message"
          placeholder="Send a message"
          enterKeyHint={hasHardwareKeyboard() ? "send" : "enter"}
          // leaves room for the chat while the on-screen keyboard is open
          className="max-h-[min(--spacing(64),calc(var(--viewport-height)*0.4))]"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <InputGroupAddon align="block-end">
          {/* phones get one menu instead of a row of buttons, which would not fit */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<InputGroupButton size="icon-xs" aria-label="More" className="sm:hidden" />}
            >
              <PlusIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="w-56">
              <DropdownMenuItem onClick={() => fileInput.current?.click()}>
                <PaperclipIcon />
                Attach files
              </DropdownMenuItem>
              {hasServers && (
                <>
                  <DropdownMenuItem onClick={() => setPicker("resources")}>
                    <DatabaseIcon />
                    MCP resources
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPicker("prompts")}>
                    <SquareSlashIcon />
                    MCP prompts
                  </DropdownMenuItem>
                </>
              )}
              {dictation.supported && (
                <DropdownMenuItem onClick={() => void dictation.toggle()}>
                  <MicIcon />
                  {dictation.listening ? "Stop dictation" : "Dictate"}
                </DropdownMenuItem>
              )}
              {(showReasoning || showMode) && <DropdownMenuSeparator />}
              {showReasoning && (
                <OptionSubmenu
                  option={reasoningOption}
                  value={settings.reasoning}
                  onChange={(reasoning) => onSettingsChange({ reasoning })}
                />
              )}
              {showMode && (
                <OptionSubmenu
                  option={modeOption}
                  value={settings.mode}
                  onChange={(mode) => onSettingsChange({ mode })}
                />
              )}
              {context && (
                <>
                  <DropdownMenuSeparator />
                  {/* a label has to be inside a group */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="tabular-nums">Context used: {context}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Hint label="Attach files">
            <InputGroupButton
              size="icon-xs"
              className="max-sm:hidden"
              onClick={() => fileInput.current?.click()}
            >
              <PaperclipIcon />
            </InputGroupButton>
          </Hint>
          {hasServers && (
            <>
              <McpPicker
                label="MCP resources"
                icon={<DatabaseIcon />}
                className="max-sm:hidden"
                anchor={composer}
                open={picker === "resources"}
                onOpenChange={(open) => setPicker(open ? "resources" : undefined)}
                load={() => resourceEntries(servers)}
                onPick={(parts) => setFiles((current) => [...current, ...parts])}
              />
              <McpPicker
                label="MCP prompts"
                icon={<SquareSlashIcon />}
                className="max-sm:hidden"
                anchor={composer}
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
                // on phones only while listening, so it can be stopped
                className={cn(!dictation.listening && "max-sm:hidden")}
                aria-pressed={dictation.listening}
                onClick={() => void dictation.toggle()}
              >
                <MicIcon />
              </InputGroupButton>
            </Hint>
          )}
          {showMode && (
            <OptionPicker
              option={modeOption}
              className="max-sm:hidden"
              value={settings.mode}
              onChange={(mode) => onSettingsChange({ mode })}
            />
          )}
          {showReasoning && (
            <OptionPicker
              option={reasoningOption}
              className="max-sm:hidden"
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
          {context && (
            <Hint label="Context used">
              <InputGroupText className="shrink-0 text-xs tabular-nums max-sm:hidden">
                {context}
              </InputGroupText>
            </Hint>
          )}
          <InputGroupButton
            size="icon-sm"
            variant="default"
            className="shrink-0"
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
