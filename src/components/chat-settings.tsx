import {
  BrainIcon,
  type LucideIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
} from "lucide-react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/hint";
import { InputGroupButton } from "@/components/ui/input-group";
import type { Model } from "@/lib/connection";
import type { Settings } from "@/lib/settings";
import { executionModes, reasoningLevels } from "@/lib/schemas";

const reasoningLabels: Record<Settings["reasoning"], string> = {
  "provider-default": "Default",
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const modeLabels: Record<Settings["mode"], string> = {
  allow: "Allow all",
  ask: "Ask first",
  deny: "Read-only",
};

const modeIcons: Record<Settings["mode"], LucideIcon> = {
  allow: ShieldOffIcon,
  ask: ShieldCheckIcon,
  deny: ShieldIcon,
};

interface PickerProps<T> {
  value: T;
  onChange: (value: T) => void;
}

export function ModelPicker({
  value,
  onChange,
  models,
}: PickerProps<string> & { models: Model[] }) {
  return (
    <Combobox
      items={models.map((model) => model.id)}
      value={value}
      onValueChange={(next) => next && onChange(next)}
    >
      <ComboboxTrigger render={<InputGroupButton className="min-w-0" />}>
        <span className="truncate">
          <ComboboxValue />
        </span>
      </ComboboxTrigger>
      <ComboboxContent className="min-w-72">
        <ComboboxInput showTrigger={false} placeholder="Search models" />
        <ComboboxEmpty>No models found.</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => (
            <ComboboxItem key={id} value={id}>
              {id}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

interface OptionPickerProps<T extends string> extends PickerProps<T> {
  label: string;
  icon: LucideIcon;
  options: readonly T[];
  labels: Record<T, string>;
}

// The trigger only shows an icon, its value is named in the hint and the menu.
function OptionPicker<T extends string>({
  label,
  icon: Icon,
  options,
  labels,
  value,
  onChange,
}: OptionPickerProps<T>) {
  return (
    <DropdownMenu>
      <Hint label={`${label}: ${labels[value]}`}>
        <DropdownMenuTrigger render={<InputGroupButton size="icon-xs" aria-label={label} />}>
          <Icon />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent className="w-40">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((candidate) => candidate === next);

            if (option) {
              onChange(option);
            }
          }}
        >
          {/* a group label has to be inside its group */}
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {labels[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ReasoningPicker(props: PickerProps<Settings["reasoning"]>) {
  return (
    <OptionPicker
      label="Reasoning"
      icon={BrainIcon}
      options={reasoningLevels}
      labels={reasoningLabels}
      {...props}
    />
  );
}

export function ModePicker(props: PickerProps<Settings["mode"]>) {
  return (
    <OptionPicker
      label="MCP tools"
      icon={modeIcons[props.value]}
      options={executionModes}
      labels={modeLabels}
      {...props}
    />
  );
}
