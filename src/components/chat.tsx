import { useChat } from "@ai-sdk/react";
import { type FileUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { MessageSquareIcon } from "lucide-react";
import { useEffect, useState } from "react";

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
import { useStableCallback } from "@/hooks/use-stable-callback";
import { type ChatMessage, continueRequest, createTransport } from "@/lib/chat";
import { config } from "@/lib/config";
import type { Session } from "@/lib/connection";
import { type PromptMessages, type ServerErrorHandler, serverTools } from "@/lib/mcp";
import { type LoadedThread, saveThread, threadSaver, updateThread } from "@/lib/threads";
import { openThread, type Route } from "@/lib/route";
import { chatSettingsSchema, metadataSchema } from "@/lib/schemas";
import { type Settings, updateUserSettings, useChatSettings } from "@/lib/settings";
import { errorMessage, now } from "@/lib/utils";

// Streamed text arrives in many small chunks, so the chat re-renders at most this often while it streams.
const renderInterval = 50;

const reportServerError: ServerErrorHandler = (server, error) =>
  toast.add({
    type: "error",
    title: `The MCP server ${server} is unavailable`,
    description: errorMessage(error),
  });

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
  const settings = useChatSettings(chatSettings, models);
  const snapshot = chatSettingsSchema.parse(settings);

  // Connects to the MCP servers before the first message, whose request reports the servers that cannot be reached.
  useEffect(() => {
    void serverTools(settings, () => undefined);
  }, [settings]);

  const [save] = useState(() => threadSaver(id, initial));

  const persist = (messages: ChatMessage[]) => {
    if (!temporary) {
      void save(snapshot, messages);
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
    transport: createTransport(connection, settings, id, reportServerError),
    throttle: renderInterval,
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

  // edits outside of a request, which the chat's onFinish does not see
  const replace = (next: ChatMessage[]) => {
    setMessages(next);
    persist(next);
  };

  // The actions of messages keep their identity while a reply streams, so that only the streaming message re-renders.
  const retry = useStableCallback((messageId: string) => void regenerate({ messageId }));
  const continueReply = useStableCallback(() => void sendMessage(undefined, continueRequest));
  const edit = useStableCallback((messageId: string, text: string, files: FileUIPart[]) =>
    send(text, files, messageId),
  );
  const approve = useStableCallback(
    (approvalId: string, approved: boolean) =>
      void addToolApprovalResponse({ id: approvalId, approved }),
  );

  const fork = useStableCallback((messageId: string) => {
    const forkId = crypto.randomUUID();
    const end = messages.findIndex((message) => message.id === messageId) + 1;
    void saveThread(forkId, snapshot, messages.slice(0, end)).then(() => openThread(forkId));
  });

  const remove = useStableCallback((messageId: string) =>
    replace(messages.filter((message) => message.id !== messageId)),
  );

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
                    onRetry={retry}
                    onContinue={continueReply}
                    onEdit={edit}
                    onFork={fork}
                    onDelete={remove}
                    onApprove={approve}
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
