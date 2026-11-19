const coarse = window.matchMedia("(pointer: coarse)");
const anyFine = window.matchMedia("(any-pointer: fine)");

/** Whether the primary pointer is a finger, where focusing a field opens the on-screen keyboard. */
export function isTouchScreen(): boolean {
  return coarse.matches;
}

/**
 * Whether a mouse or trackpad is attached, which usually comes with a hardware keyboard,
 * so that Enter can send messages while Shift+Enter starts a new line.
 */
export function hasHardwareKeyboard(): boolean {
  return anyFine.matches;
}
