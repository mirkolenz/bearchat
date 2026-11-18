import { useRef, useState } from "react";

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

/** Dictation that only runs on-device, so audio never leaves the browser. */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognition>(null);

  const toggle = async () => {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }

    // checked on demand since the check itself may download the language pack
    if ((await SpeechRecognition.available(options)) === "unavailable") {
      throw new Error(`On-device dictation is not available for ${navigator.language}`);
    }

    await SpeechRecognition.install(options);
    const instance = new SpeechRecognition();
    instance.lang = navigator.language;
    instance.continuous = true;
    instance.processLocally = true;
    instance.addEventListener("result", (event) => {
      const results = Array.from(event.results).slice(event.resultIndex);
      onText(results.map((result) => result[0].transcript).join(" "));
    });
    instance.addEventListener("end", () => {
      recognition.current = null;
      setListening(false);
    });
    recognition.current = instance;
    instance.start();
    setListening(true);
  };

  return { supported, listening, toggle };
}
