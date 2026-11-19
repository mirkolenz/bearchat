import { useState } from "react";

/** Runs the action on the second click, after the first one asked for confirmation. */
export function useConfirm(action: () => void) {
  const [confirming, setConfirming] = useState(false);
  return { confirming, click: () => (confirming ? action() : setConfirming(true)) };
}
