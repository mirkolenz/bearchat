import {
  type DynamicToolUIPart,
  type FileUIPart,
  getToolName,
  isFileUIPart,
  isToolUIPart,
  type ReasoningUIPart,
  type ToolUIPart,
  type UITools,
} from "ai";
import {
  BrainIcon,
  CheckIcon,
  CopyIcon,
  FastForwardIcon,
  FileTextIcon,
  GitForkIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  Volume2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { type ComponentProps, type FormEvent, useState } from "react";

import { Hint } from "@/components/hint";
import { Markdown } from "@/components/markdown";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { type ChatMessage, messageText } from "@/lib/chat";
import { speak } from "@/lib/speech";
import { cn, compactNumber } from "@/lib/utils";

interface ChatMessageViewProps {
  message: ChatMessage;
  streaming: boolean;
  busy: boolean;
  last: boolean;
  onRetry: () => void;
  onContinue: () => void;
  onEdit: (text: string, files: FileUIPart[]) => void;
  onFork: () => void;
  onDelete: () => void;
  onApprove: (id: string, approved: boolean) => void;
}

export function ChatMessageView({
  message,
  streaming,
  busy,
  last,
  onRetry,
  onContinue,
  onEdit,
  onFork,
  onDelete,
  onApprove,
}: ChatMessageViewProps) {
  const [editing, setEditing] = useState(false);
  const isUser = message.role === "user";
  const files = message.parts.filter(isFileUIPart);
  const text = messageText(message);

  if (editing) {
    return (
      <EditForm
        text={text}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
          setEditing(false);
          onEdit(next, files);
        }}
      />
    );
  }

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        {files.length > 0 && <Attachments files={files} />}
        {message.parts.map((part, index) => {
          const key = `${message.id}-${index}`;

          if (isToolUIPart(part)) {
            return <ToolCall key={key} part={part} onApprove={onApprove} />;
          }

          switch (part.type) {
            case "text":
              return isUser ? (
                <Bubble key={key} variant="secondary">
                  <BubbleContent className="whitespace-pre-wrap">{part.text}</BubbleContent>
                </Bubble>
              ) : (
                <Markdown key={key} streaming={streaming && part.state === "streaming"}>
                  {part.text}
                </Markdown>
              );
            case "reasoning":
              return <Reasoning key={key} part={part} streaming={streaming} />;
            default:
              return null;
          }
        })}
        {!streaming && (
          <MessageFooter className="gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
            <CopyButton text={text} />
            <Action
              label="Read aloud"
              onClick={() => (speechSynthesis.speaking ? speechSynthesis.cancel() : speak(text))}
            >
              <Volume2Icon />
            </Action>
            {isUser ? (
              <Action label="Edit" disabled={busy} onClick={() => setEditing(true)}>
                <PencilIcon />
              </Action>
            ) : (
              <>
                <Action label="Retry" disabled={busy} onClick={onRetry}>
                  <RefreshCwIcon />
                </Action>
                {last && (
                  <Action label="Continue" disabled={busy} onClick={onContinue}>
                    <FastForwardIcon />
                  </Action>
                )}
              </>
            )}
            <Action label="Fork into a new chat" disabled={busy} onClick={onFork}>
              <GitForkIcon />
            </Action>
            <Action label="Delete" disabled={busy} onClick={onDelete}>
              <Trash2Icon />
            </Action>
            {message.metadata?.model && <MessageDetails message={message} />}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

function Action({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Hint label={label}>
      <Button variant="ghost" size="icon-xs" {...props} />
    </Hint>
  );
}

function MessageDetails({ message }: { message: ChatMessage }) {
  const { model, createdAt, firstTokenAt, finishedAt, inputTokens, outputTokens } =
    message.metadata ?? {};
  const details = [model];

  if (inputTokens !== undefined && outputTokens !== undefined) {
    details.push(
      `${compactNumber.format(inputTokens)} in`,
      `${compactNumber.format(outputTokens)} out`,
    );
  }

  if (firstTokenAt !== undefined && finishedAt !== undefined && outputTokens !== undefined) {
    details.push(`${(outputTokens / ((finishedAt - firstTokenAt) / 1000)).toFixed(1)} tok/s`);
  }

  if (createdAt !== undefined && firstTokenAt !== undefined) {
    details.push(`${((firstTokenAt - createdAt) / 1000).toFixed(1)} s to first token`);
  }

  return <span className="ml-1 truncate">{details.join(" · ")}</span>;
}

interface AttachmentsProps {
  files: FileUIPart[];
  onRemove?: (index: number) => void;
}

export function Attachments({ files, onRemove }: AttachmentsProps) {
  return (
    <AttachmentGroup>
      {files.map((file, index) => (
        <Attachment key={index} orientation="vertical" size="sm">
          {file.mediaType.startsWith("image/") ? (
            <AttachmentMedia variant="image">
              <img src={file.url} alt={file.filename ?? "Attachment"} />
            </AttachmentMedia>
          ) : (
            <>
              <AttachmentMedia>
                <FileTextIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{file.filename}</AttachmentTitle>
              </AttachmentContent>
            </>
          )}
          {onRemove && (
            <AttachmentActions>
              <AttachmentAction aria-label="Remove attachment" onClick={() => onRemove(index)}>
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          )}
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

const toolStates: Record<(ToolUIPart<UITools> | DynamicToolUIPart)["state"], string> = {
  "input-streaming": "preparing",
  "input-available": "running",
  "approval-requested": "waiting for approval",
  "approval-responded": "approved",
  "output-available": "done",
  "output-error": "failed",
  "output-denied": "denied",
};

interface ToolValueProps {
  label: string;
  value: unknown;
  className?: string;
}

function ToolValue({ label, value, className }: ToolValueProps) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <pre
        className={cn(
          "max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap",
          className,
        )}
      >
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

interface ToolCallProps {
  part: ToolUIPart<UITools> | DynamicToolUIPart;
  onApprove: (id: string, approved: boolean) => void;
}

function ToolCall({ part, onApprove }: ToolCallProps) {
  const failed = part.state === "output-error" || part.state === "output-denied";
  const running = part.state === "input-streaming" || part.state === "input-available";

  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={failed ? "error" : running ? "running" : undefined}>
            <TraceIcon>
              <WrenchIcon />
            </TraceIcon>
            <TraceTitle>{getToolName(part)}</TraceTitle>
            <TraceDescription>{toolStates[part.state]}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          <ToolValue label="Input" value={part.input} />
          {part.state === "output-available" && <ToolValue label="Output" value={part.output} />}
          {part.state === "output-error" && (
            <ToolValue label="Error" value={part.errorText} className="text-destructive" />
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
      {part.state === "approval-requested" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onApprove(part.approval.id, true)}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onApprove(part.approval.id, false)}>
            Deny
          </Button>
        </div>
      )}
    </Trace>
  );
}

function Reasoning({ part, streaming }: { part: ReasoningUIPart; streaming: boolean }) {
  const [open, setOpen] = useState<boolean>();
  const running = streaming && part.state === "streaming";

  // Opens while the model is thinking unless the user toggled it.
  return (
    <Trace>
      <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceIcon>
              <BrainIcon />
            </TraceIcon>
            <TraceTitle>{running ? "Thinking" : "Thoughts"}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Markdown streaming={running}>{part.text}</Markdown>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Action label="Copy" onClick={() => void copy()}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Action>
  );
}

interface EditFormProps {
  text: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}

function EditForm({ text, onCancel, onSave }: EditFormProps) {
  const [value, setValue] = useState(text);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (value.trim()) {
      onSave(value);
    }
  };

  return (
    <form onSubmit={submit}>
      <InputGroup>
        <InputGroupTextarea
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && onCancel()}
        />
        <InputGroupAddon align="block-end" className="justify-end">
          <InputGroupButton onClick={onCancel}>Cancel</InputGroupButton>
          <InputGroupButton type="submit" variant="default">
            Send
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
