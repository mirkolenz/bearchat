import { type FormEvent, useId } from "react";
import { z } from "zod";

import { DialogBody, DialogPanel } from "@/components/dialog-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { type InputRequest, useInputRequest } from "@/lib/elicitation";

// The restricted JSON Schema of elicitation forms: a flat object of primitive and enum properties.
const labels = { title: z.string().optional(), description: z.string().optional() };
const choiceSchema = z.object({ const: z.string(), title: z.string().optional() });
const propertySchema = z.discriminatedUnion("type", [
  z.object({
    ...labels,
    type: z.literal("string"),
    enum: z.array(z.string()).optional(),
    enumNames: z.array(z.string()).optional(),
    oneOf: z.array(choiceSchema).optional(),
    format: z.enum(["email", "uri", "date", "date-time"]).optional(),
    minLength: z.int().optional(),
    maxLength: z.int().optional(),
    default: z.string().optional(),
  }),
  z.object({
    ...labels,
    type: z.enum(["number", "integer"]),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    default: z.number().optional(),
  }),
  z.object({ ...labels, type: z.literal("boolean"), default: z.boolean().optional() }),
  z.object({
    ...labels,
    type: z.literal("array"),
    items: z.object({
      enum: z.array(z.string()).optional(),
      anyOf: z.array(choiceSchema).optional(),
    }),
    default: z.array(z.string()).optional(),
  }),
]);
const formSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), propertySchema),
  required: z.array(z.string()).default([]),
});

type Property = z.infer<typeof propertySchema>;

const inputTypes = {
  email: "email",
  uri: "url",
  date: "date",
  "date-time": "datetime-local",
} as const;

/** The options of an enum, from plain values with optional names or from titled constants. */
function choices(values?: string[], names?: string[], titled?: z.infer<typeof choiceSchema>[]) {
  return (
    titled?.map((choice) => ({ value: choice.const, label: choice.title ?? choice.const })) ??
    values?.map((value, index) => ({ value, label: names?.[index] ?? value })) ??
    []
  );
}

/** Reads one property from the submitted form, undefined if it was left empty. */
function readValue(data: FormData, key: string, property: Property): unknown {
  switch (property.type) {
    case "boolean":
      return data.get(key) === "on";
    case "array":
      return data.getAll(key);
    case "number":
    case "integer": {
      const value = data.get(key);
      return value === null || value === "" ? undefined : Number(value);
    }
    case "string": {
      const value = data.get(key);
      return typeof value === "string" && value !== "" ? value : undefined;
    }
  }
}

function PropertyField({
  name,
  property,
  required,
}: {
  name: string;
  property: Property;
  required: boolean;
}) {
  const id = useId();
  const label = property.title ?? name;
  const description = property.description && (
    <FieldDescription>{property.description}</FieldDescription>
  );

  switch (property.type) {
    case "boolean":
      return (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description}
          </FieldContent>
          <Switch id={id} name={name} defaultChecked={property.default} />
        </Field>
      );
    case "array":
      return (
        <FieldSet>
          <FieldLegend variant="label">{label}</FieldLegend>
          {description}
          {choices(property.items.enum, undefined, property.items.anyOf).map((choice) => (
            <Field key={choice.value} orientation="horizontal">
              <Checkbox
                id={`${id}-${choice.value}`}
                name={name}
                value={choice.value}
                defaultChecked={property.default?.includes(choice.value)}
              />
              <FieldLabel htmlFor={`${id}-${choice.value}`}>{choice.label}</FieldLabel>
            </Field>
          ))}
        </FieldSet>
      );
    case "string": {
      const options = choices(property.enum, property.enumNames, property.oneOf);
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {options.length > 0 ? (
            <NativeSelect id={id} name={name} required={required} defaultValue={property.default}>
              {!required && <NativeSelectOption value="">None</NativeSelectOption>}
              {options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id={id}
              name={name}
              type={property.format ? inputTypes[property.format] : "text"}
              required={required}
              minLength={property.minLength}
              maxLength={property.maxLength}
              defaultValue={property.default}
            />
          )}
          {description}
        </Field>
      );
    }
    case "number":
    case "integer":
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            name={name}
            type="number"
            step={property.type === "integer" ? 1 : "any"}
            required={required}
            min={property.minimum}
            max={property.maximum}
            defaultValue={property.default}
          />
          {description}
        </Field>
      );
  }
}

function RequestForm({ request }: { request: InputRequest }) {
  const form = formSchema.safeParse(request.requestedSchema);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // React passes submit events up through the dialog's portal to any enclosing form
    event.stopPropagation();

    if (!form.success) {
      return;
    }

    const data = new FormData(event.currentTarget);
    const content = Object.fromEntries(
      Object.entries(form.data.properties).flatMap(([key, property]) => {
        const value = readValue(data, key, property);
        return value === undefined ? [] : [[key, value]];
      }),
    );
    request.respond({ action: "accept", content });
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>{request.server} asks for input</DialogTitle>
        <DialogDescription className="whitespace-pre-wrap">{request.message}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        {form.success ? (
          <FieldGroup>
            {Object.entries(form.data.properties).map(([name, property]) => (
              <PropertyField
                key={name}
                name={name}
                property={property}
                required={form.data.required.includes(name)}
              />
            ))}
          </FieldGroup>
        ) : (
          <p className="text-sm text-destructive">
            The server requested input in an unsupported format.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => request.respond({ action: "decline" })}
        >
          Decline
        </Button>
        <Button type="submit" disabled={!form.success}>
          Submit
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Shows the input requests of MCP servers one at a time, closing the dialog cancels the request. */
export function InputRequestDialog() {
  const request = useInputRequest();

  return (
    <Dialog
      open={request !== undefined}
      onOpenChange={(open) => !open && request?.respond({ action: "cancel" })}
    >
      <DialogPanel>{request && <RequestForm key={request.id} request={request} />}</DialogPanel>
    </Dialog>
  );
}
