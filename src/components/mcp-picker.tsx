import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import type { FileUIPart } from "ai";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";

import { DialogBody, DialogPanel } from "@/components/dialog-panel";
import { Hint } from "@/components/hint";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroupButton } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { isTouchScreen } from "@/lib/pointer";
import {
  complete,
  type CompletionRef,
  getPrompt,
  listPrompts,
  listResources,
  type McpServer,
  type PromptMessages,
  readResource,
} from "@/lib/mcp";
import { expandTemplate, templateVariables } from "@/lib/uri-template";
import { errorMessage } from "@/lib/utils";

interface Argument {
  name: string;
  description?: string;
  required: boolean;
}

/** Something a server offers, which is opened with values for its arguments. */
interface PickerEntry<T> {
  key: string;
  server: McpServer;
  title: string;
  description?: string;
  arguments: Argument[];
  ref: CompletionRef;
  open: (values: Record<string, string>) => Promise<T>;
}

/** The resources and resource templates of the servers, read into attachable parts. */
export async function resourceEntries(servers: McpServer[]): Promise<PickerEntry<FileUIPart[]>[]> {
  const { resources, templates } = await listResources(servers);
  return [
    ...resources.map(({ server, resource }) => ({
      key: `${server.name} ${resource.uri}`,
      server,
      title: resource.title ?? resource.name,
      description: resource.description ?? resource.uri,
      arguments: [],
      ref: { type: "ref/resource" as const, uri: resource.uri },
      open: () => readResource(server, resource.uri),
    })),
    ...templates.map(({ server, template }) => ({
      key: `${server.name} ${template.uriTemplate}`,
      server,
      title: template.title ?? template.name,
      description: template.description ?? template.uriTemplate,
      arguments: templateVariables(template.uriTemplate).map((name) => ({ name, required: false })),
      ref: { type: "ref/resource" as const, uri: template.uriTemplate },
      open: (values: Record<string, string>) =>
        readResource(server, expandTemplate(template.uriTemplate, values)),
    })),
  ];
}

/** The prompts of the servers, expanded into chat messages. */
export async function promptEntries(servers: McpServer[]): Promise<PickerEntry<PromptMessages>[]> {
  return (await listPrompts(servers)).map(({ server, prompt }) => ({
    key: `${server.name} ${prompt.name}`,
    server,
    title: prompt.title ?? prompt.name,
    description: prompt.description,
    arguments: (prompt.arguments ?? []).map((argument) => ({
      name: argument.name,
      description: argument.description,
      required: argument.required ?? false,
    })),
    ref: { type: "ref/prompt" as const, name: prompt.name },
    open: (values: Record<string, string>) => getPrompt(server, prompt.name, values),
  }));
}

/** A text field whose suggestions come from the server's completions. */
function ArgumentInput<T>({
  entry,
  argument,
  values,
  onChange,
}: {
  entry: PickerEntry<T>;
  argument: Argument;
  values: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const value = values[argument.name] ?? "";
  const timer = useRef<number>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Only the edited field asks for suggestions, once typing pauses.
  const suggest = (text: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const context = Object.fromEntries(
        Object.entries(values).filter(([name]) => name !== argument.name),
      );
      setSuggestions(await complete(entry.server, entry.ref, argument.name, text, context));
    }, 250);
  };

  return (
    <Field>
      <FieldLabel htmlFor={id}>{argument.name}</FieldLabel>
      <Input
        id={id}
        list={`${id}-suggestions`}
        autoComplete="off"
        required={argument.required}
        value={value}
        onFocus={() => suggest(value)}
        onChange={(event) => {
          onChange(event.target.value);
          suggest(event.target.value);
        }}
      />
      <datalist id={`${id}-suggestions`}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion}>
            {suggestion}
          </option>
        ))}
      </datalist>
      {argument.description && <FieldDescription>{argument.description}</FieldDescription>}
    </Field>
  );
}

/** Asks for the arguments of an entry and opens it with them. */
function ArgumentDialog<T>({
  entry,
  onOpen,
  onClose,
}: {
  entry: PickerEntry<T>;
  onOpen: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // React passes submit events up through the dialog's portal to any enclosing form
    event.stopPropagation();
    setOpening(true);

    try {
      // empty optional arguments are left out, which drops them from templates
      await onOpen(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")));
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }

    setOpening(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel>
        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogHeader>
            <DialogTitle>{entry.title}</DialogTitle>
            <DialogDescription>
              {entry.server.name}
              {entry.description && ` · ${entry.description}`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              {entry.arguments.map((argument) => (
                <ArgumentInput
                  key={argument.name}
                  entry={entry}
                  argument={argument}
                  values={values}
                  onChange={(value) => setValues({ ...values, [argument.name]: value })}
                />
              ))}
            </FieldGroup>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={opening}>
              {opening && <Spinner data-icon="inline-start" />}
              Insert
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </Dialog>
  );
}

interface McpPickerProps<T> {
  label: string;
  icon: ReactNode;
  // controlled, so that typing a slash can open the prompts
  open: boolean;
  onOpenChange: (open: boolean) => void;
  load: () => Promise<PickerEntry<T>[]>;
  onPick: (value: T) => void;
  // the list opens at this element, so it can also be opened while the trigger is hidden
  anchor: RefObject<HTMLElement | null>;
  className?: string;
}

/** A searchable list of what the servers offer, which asks for arguments if needed and hands the result back. */
export function McpPicker<T>({
  label,
  icon,
  open,
  onOpenChange,
  load,
  onPick,
  anchor,
  className,
}: McpPickerProps<T>) {
  const [entries, setEntries] = useState<PickerEntry<T>[]>();
  const [selected, setSelected] = useState<PickerEntry<T>>();

  // the latest load function, without reloading whenever the parent renders a new one
  const list = useEffectEvent(() => load());

  // listed afresh on every opening, so the servers' current offers are shown
  useEffect(() => {
    if (open) {
      list().then(setEntries, (error: unknown) =>
        toast.add({ type: "error", title: `${label} failed`, description: errorMessage(error) }),
      );
    }
  }, [open, label]);

  const pick = async (entry: PickerEntry<T>) => {
    try {
      onPick(await entry.open({}));
    } catch (error) {
      toast.add({ type: "error", title: entry.title, description: errorMessage(error) });
    }
  };

  return (
    <>
      <Combobox
        items={entries ?? []}
        value={null}
        open={open}
        onOpenChange={onOpenChange}
        itemToStringLabel={(entry: PickerEntry<T>) =>
          [entry.title, entry.server.name, entry.description].join(" ")
        }
        onValueChange={(entry) => {
          if (entry === null) {
            return;
          }

          if (entry.arguments.length === 0) {
            void pick(entry);
          } else {
            setSelected(entry);
          }
        }}
      >
        <Hint label={label}>
          {/* the primitive trigger, since the styled one adds a chevron to the icon button */}
          <ComboboxPrimitive.Trigger
            render={<InputGroupButton size="icon-xs" aria-label={label} className={className} />}
          >
            {icon}
          </ComboboxPrimitive.Trigger>
        </Hint>
        {/* focusing the search on touch screens would cover the list with the keyboard */}
        <ComboboxContent anchor={anchor} initialFocus={!isTouchScreen()}>
          <ComboboxInput showTrigger={false} placeholder={`Search ${label}`} />
          <ComboboxEmpty>{entries === undefined ? "Loading…" : "Nothing found."}</ComboboxEmpty>
          <ComboboxList>
            {(entry: PickerEntry<T>) => (
              <ComboboxItem key={entry.key} value={entry}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{entry.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.server.name}
                    {entry.description && ` · ${entry.description}`}
                  </span>
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {selected && (
        <ArgumentDialog
          entry={selected}
          onOpen={async (values) => onPick(await selected.open(values))}
          onClose={() => setSelected(undefined)}
        />
      )}
    </>
  );
}
