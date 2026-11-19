import { useChat } from "@ai-sdk/react";
import { type FileUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { MessageSquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChatMessageView } from "@/components/chat-message";
import { PromptForm } from "@/components/prompt-form";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { toast } from "@/components/ui/toast";
import { TraceLine, TraceTitle } from "@/components/ui/trace";
import { type ChatMessage, continueRequest, createTransport } from "@/lib/chat";
import { config } from "@/lib/config";
import type { Session } from "@/lib/connection";
import { type LoadedThread, saveThread, updateThread } from "@/lib/threads";
import type { PromptMessages } from "@/lib/mcp";
import { openThread, type Route } from "@/lib/route";
import { chatSettingsSchema, metadataSchema } from "@/lib/schemas";
import {
  type ResolvedSettings,
  resolveSettings,
  type Settings,
  updateUserSettings,
  useUserSettings,
} from "@/lib/settings";
import { now } from "@/lib/utils";

interface ThreadProps {
  route: Route;
  thread: LoadedThread;
  session: Session;
}

export function Thread({
  route: { id, temporary },
  thread: initial,
  session: { connection, models },
}: ThreadProps) {
  useEffect(() => {
    if (initial.skipped > 0) {
      toast.add({
        type: "error",
        title: `${initial.skipped} messages of this chat could not be loaded`,
      });
    }
  }, [initial.skipped]);
  const [chatSettings, setChatSettings] = useState(initial.settings);
  const resolved = resolveSettings(useUserSettings(), chatSettings);
  // the chat's or user's model may no longer be served
  const settings: ResolvedSettings = {
    ...resolved,
    model: models.find((model) => model.id === resolved.model)?.id ?? models[0].id,
  };
  const snapshot = chatSettingsSchema.parse(settings);

  // the first save creates the chat, later ones only update it, so a deleted chat stays deleted
  const stored = useRef(initial.exists);

  const persist = (messages: ChatMessage[]) => {
    if (!temporary) {
      void saveThread(id, snapshot, messages, !stored.current);
      stored.current = true;
    }
  };

  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    addToolApprovalResponse,
  } = useChat<ChatMessage>({
    id,
    messages: initial.messages,
    messageMetadataSchema: metadataSchema,
    transport: createTransport(connection, settings, id),
    // resumes the agent once every pending tool call has been approved or denied
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    // also called after errors and aborts, so partial responses are kept
    onFinish: ({ messages }) => persist(messages),
  });
  const busy = status === "submitted" || status === "streaming";
  const contextUsed = messages.findLast((message) => message.role === "assistant")?.metadata
    ?.totalTokens;

  // Changes apply to the user settings, and chat-scoped keys are also stored with the chat.
  const changeSettings = (patch: Partial<Settings>) => {
    updateUserSettings(patch);
    const next = { ...chatSettings, ...chatSettingsSchema.parse(patch) };
    setChatSettings(next);

    if (!temporary) {
      void updateThread(id, { settings: next });
    }
  };

  // the one path for user messages, so each one is timestamped like the replies
  const send = (text: string, files: FileUIPart[], messageId?: string) =>
    void sendMessage({ text, files, messageId, metadata: { createdAt: now() } });

  const fork = (index: number) => {
    const forkId = crypto.randomUUID();
    void saveThread(forkId, snapshot, messages.slice(0, index + 1), true).then(() =>
      openThread(forkId),
    );
  };

  // edits outside of a request, which the chat's onFinish does not see
  const replace = (next: ChatMessage[]) => {
    setMessages(next);
    persist(next);
  };

  const remove = (messageId: string) =>
    replace(messages.filter((message) => message.id !== messageId));

  const insert = (inserted: PromptMessages) =>
    replace([
      ...messages,
      ...inserted.map((message) => ({
        id: crypto.randomUUID(),
        ...message,
        metadata: { createdAt: now() },
      })),
    ]);

  return (
    <>
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
              {messages.length === 0 && (
                <Empty className="flex-1">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquareIcon />
                    </EmptyMedia>
                    <EmptyTitle>{temporary ? "Temporary chat" : config.title}</EmptyTitle>
                    <EmptyDescription>
                      {temporary
                        ? "This chat is not saved."
                        : `Start chatting with ${settings.model}.`}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {messages.map((message, index) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                  // items clip their paint, this padding keeps focus rings at their edges visible
                  className="-mx-1 px-1"
                >
                  <ChatMessageView
                    message={message}
                    streaming={status === "streaming" && index === messages.length - 1}
                    busy={busy}
                    last={index === messages.length - 1}
                    onRetry={() => void regenerate({ messageId: message.id })}
                    onContinue={() => void sendMessage(undefined, continueRequest)}
                    onEdit={(text, files) => send(text, files, message.id)}
                    onFork={() => fork(index)}
                    onDelete={() => remove(message.id)}
                    onApprove={(approvalId, approved) =>
                      void addToolApprovalResponse({ id: approvalId, approved })
                    }
                  />
                </MessageScrollerItem>
              ))}
              {status === "submitted" && (
                <MessageScrollerItem messageId="pending">
                  <TraceLine status="running">
                    <TraceTitle>Processing</TraceTitle>
                  </TraceLine>
                </MessageScrollerItem>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Request failed</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                  <AlertAction>
                    <Button size="sm" variant="outline" onClick={() => void regenerate()}>
                      Retry
                    </Button>
                  </AlertAction>
                </Alert>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <PromptForm
        busy={busy}
        models={models}
        settings={settings}
        contextUsed={contextUsed}
        onSettingsChange={changeSettings}
        onSubmit={(text, files) => send(text, files)}
        onInsertMessages={insert}
        onStop={() => void stop()}
      />
    </>
  );
}
