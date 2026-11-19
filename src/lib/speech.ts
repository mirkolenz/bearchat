import { useEffect, useRef, useState } from "react";

const language = new Intl.Locale(navigator.language).language;

/** Reads text aloud with an on-device voice when the browser offers one. */
export function speak(text: string) {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice =
    speechSynthesis
      .getVoices()
      .find((voice) => voice.localService && new Intl.Locale(voice.lang).language === language) ??
    null;
  speechSynthesis.speak(utterance);
}

const options = { langs: [navigator.language], processLocally: true };
// only Chromium offers on-device recognition
const supported = "SpeechRecognition" in window && "available" in SpeechRecognition;

/** Downloads the language pack if needed, checked on demand since the check itself may download it. */
async function prepareDictation() {
  if ((await SpeechRecognition.available(options)) === "unavailable") {
    throw new Error(`On-device dictation is not available for ${navigator.language}`);
  }

  await SpeechRecognition.install(options);
}

/** Dictation that only runs on-device, so audio never leaves the browser. */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  // set while preparing too, so that a second toggle cancels instead of starting another one
  const recognition = useRef<SpeechRecognition>(null);

  // dictation ends with the chat, e.g. when another one is opened
  useEffect(
    () => () => {
      const current = recognition.current;
      recognition.current = null;
      current?.abort();
    },
    [],
  );

  // ends the instance's session unless another one took its place
  const release = (instance: SpeechRecognition) => {
    if (recognition.current === instance) {
      recognition.current = null;
      setListening(false);
    }
  };

  const toggle = async () => {
    const current = recognition.current;

    if (current) {
      release(current);
      current.stop();
      return;
    }

    const instance = new SpeechRecognition();
    instance.lang = navigator.language;
    instance.continuous = true;
    instance.processLocally = true;
    instance.addEventListener("result", (event) => {
      const results = Array.from(event.results).slice(event.resultIndex);
      onText(results.map((result) => result[0].transcript).join(" "));
    });
    instance.addEventListener("end", () => release(instance));
    recognition.current = instance;
    setListening(true);

    await prepareDictation().catch((error: unknown) => {
      release(instance);
      throw error;
    });

    // unless it was stopped or the chat closed in the meantime
    if (recognition.current === instance) {
      instance.start();
    }
  };

  return { supported, listening, toggle };
}
