import { useState } from "react";

/**
 * Runs the action on the second click, after the first one asked for confirmation.
 * Like the dependencies of an effect, a changed subject asks again.
 */
export function useConfirm(action: () => void, subject: readonly unknown[] = []) {
  const [pending, setPending] = useState<readonly unknown[]>();
  const confirming =
    pending?.length === subject.length &&
    pending.every((value, index) => Object.is(value, subject[index]));

  const click = () => {
    if (!confirming) {
      setPending(subject);
      return;
    }

    setPending(undefined);
    action();
  };

  return { confirming, click };
}
