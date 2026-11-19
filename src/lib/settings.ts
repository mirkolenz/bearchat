import { useSyncExternalStore } from "react";
import { z } from "zod";

import { config } from "@/lib/config";
import { chatSettingsSchema, type SettingKey, settingsSchema } from "@/lib/schemas";
import { jsonSchema } from "@/lib/utils";

// Settings are resolved from these layers, later ones take precedence:
// built-in, deployment (`defaults` in config.json), user (this browser), chat (stored with each chat),
// and finally the deployment's locked keys, which the UI hides.

const builtinSettings = {
  reasoning: "provider-default",
  mode: "ask",
  instructions: "",
  requestBody: {},
  pythonTool: true,
  fileTools: true,
  chatTools: true,
  mcpServers: {},
} as const satisfies Partial<z.infer<typeof settingsSchema>>;
const base = { ...builtinSettings, ...config.defaults };

export const lockedSettings: ReadonlySet<SettingKey> = new Set(
  settingsSchema.keyof().options.filter((key) => config.locked[key] !== undefined),
);

// User and chat values that no longer validate fall back to the lower layers field by field.
const resolvedSchema = z.object({
  model: settingsSchema.shape.model.optional().catch(base.model),
  reasoning: settingsSchema.shape.reasoning.catch(base.reasoning),
  mode: settingsSchema.shape.mode.catch(base.mode),
  instructions: settingsSchema.shape.instructions.catch(base.instructions),
  requestBody: settingsSchema.shape.requestBody.catch(base.requestBody),
  pythonTool: settingsSchema.shape.pythonTool.catch(base.pythonTool),
  fileTools: settingsSchema.shape.fileTools.catch(base.fileTools),
  chatTools: settingsSchema.shape.chatTools.catch(base.chatTools),
  mcpServers: settingsSchema.shape.mcpServers.catch(base.mcpServers),
});

export type Settings = z.infer<typeof resolvedSchema>;
// settings once the model has been resolved against the models the server offers
export type ResolvedSettings = Settings & { model: string };
export type ChatSettings = z.infer<typeof chatSettingsSchema>;
// stored as written and validated when resolved, so one outdated field does not discard the others
type UserLayer = Record<string, unknown>;

export function resolveSettings(user: UserLayer, chat: ChatSettings = {}): Settings {
  return resolvedSchema.parse({ ...user, ...chat, ...config.locked });
}

// Only the user's changes are stored, so later deployment or built-in changes still apply.
const storageKey = "bearchat:settings";
const userLayerSchema = jsonSchema.pipe(z.record(z.string(), z.unknown())).catch({});
const listeners = new Set<() => void>();

function readUserLayer(): UserLayer {
  const value = localStorage.getItem(storageKey);
  return value === null ? {} : userLayerSchema.parse(value);
}

let userLayer = readUserLayer();
let userSettings = resolveSettings(userLayer);

function publish() {
  userSettings = resolveSettings(userLayer);
  listeners.forEach((listener) => listener());
}

// keeps open tabs in sync
window.addEventListener("storage", (event) => {
  if (event.key === storageKey) {
    userLayer = readUserLayer();
    publish();
  }
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The settings of this browser without a chat layer, which new chats start from. */
export function useUserSettings(): Settings {
  return useSyncExternalStore(subscribe, () => userSettings);
}

export function updateUserSettings(patch: Partial<Settings>) {
  userLayer = { ...userLayer, ...patch };
  localStorage.setItem(storageKey, JSON.stringify(userLayer));
  publish();
}

export function resetUserSettings() {
  userLayer = {};
  localStorage.removeItem(storageKey);
  publish();
}
