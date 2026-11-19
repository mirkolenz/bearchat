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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/hint";
import { InputGroupButton } from "@/components/ui/input-group";
import type { Model } from "@/lib/connection";
import { isTouchScreen } from "@/lib/pointer";
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
      {/* shrinks to the room left in the toolbar, where long ids are truncated */}
      <ComboboxTrigger render={<InputGroupButton className="min-w-0 shrink" />}>
        <span className="truncate">
          <ComboboxValue />
        </span>
      </ComboboxTrigger>
      {/* focusing the search on touch screens would cover the list with the keyboard */}
      <ComboboxContent className="min-w-72" initialFocus={!isTouchScreen()}>
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

/** A setting with a few named values, shown as an icon whose menu picks the value. */
interface Option<T extends string> {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  icon: LucideIcon;
  // values with their own icon
  icons?: Record<T, LucideIcon>;
}

export const reasoningOption: Option<Settings["reasoning"]> = {
  label: "Reasoning",
  values: reasoningLevels,
  labels: reasoningLabels,
  icon: BrainIcon,
};

export const modeOption: Option<Settings["mode"]> = {
  label: "MCP tools",
  values: executionModes,
  labels: modeLabels,
  icon: ShieldIcon,
  icons: modeIcons,
};

interface OptionProps<T extends string> extends PickerProps<T> {
  option: Option<T>;
}

function OptionRadioGroup<T extends string>({ option, value, onChange }: OptionProps<T>) {
  return (
    <DropdownMenuRadioGroup
      value={value}
      onValueChange={(next) => {
        const selected = option.values.find((candidate) => candidate === next);

        if (selected) {
          onChange(selected);
        }
      }}
    >
      {/* a group label has to be inside its group */}
      <DropdownMenuLabel>{option.label}</DropdownMenuLabel>
      {option.values.map((candidate) => (
        <DropdownMenuRadioItem key={candidate} value={candidate}>
          {option.labels[candidate]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

// The trigger only shows an icon, its value is named in the hint and the menu.
export function OptionPicker<T extends string>({
  className,
  ...props
}: OptionProps<T> & { className?: string }) {
  const { option, value } = props;
  const Icon = option.icons?.[value] ?? option.icon;

  return (
    <DropdownMenu>
      <Hint label={`${option.label}: ${option.labels[value]}`}>
        <DropdownMenuTrigger
          render={
            <InputGroupButton size="icon-xs" aria-label={option.label} className={className} />
          }
        >
          <Icon />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent className="w-40">
        <OptionRadioGroup {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same choice as a submenu, which names the current value next to the setting. */
export function OptionSubmenu<T extends string>(props: OptionProps<T>) {
  const { option, value } = props;
  const Icon = option.icons?.[value] ?? option.icon;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon />
        {option.label}
        <span className="ml-auto text-muted-foreground">{option.labels[value]}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-40">
        <OptionRadioGroup {...props} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
