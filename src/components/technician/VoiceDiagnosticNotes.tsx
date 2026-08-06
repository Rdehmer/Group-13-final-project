"use client";

import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type Props = {
  symptom: string;
  cause: string;
  action: string;
  onChange: (next: { symptom: string; cause: string; action: string }) => void;
  onSave: () => void | Promise<void>;
  busy?: boolean;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceDiagnosticNotes({ symptom, cause, action, onChange, onSave, busy }: Props) {
  const [listening, setListening] = useState(false);
  const [target, setTarget] = useState<"symptom" | "cause" | "action">("symptom");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognitionCtor()));
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSpeechError("Voice input is not supported in this browser. Type your notes instead.");
      return;
    }
    setSpeechError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalChunk = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
      }
      if (!finalChunk.trim()) return;
      onChange({
        symptom: target === "symptom" ? `${symptom} ${finalChunk}`.trim() : symptom,
        cause: target === "cause" ? `${cause} ${finalChunk}`.trim() : cause,
        action: target === "action" ? `${action} ${finalChunk}`.trim() : action,
      });
    };
    recognition.onerror = (event) => {
      setSpeechError(event.error === "not-allowed" ? "Microphone permission denied." : "Voice input stopped.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  return (
    <section className="space-y-3" aria-labelledby="diagnostic-notes-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="diagnostic-notes-heading" className="text-base font-semibold">
          Diagnostic notes
        </h3>
        {speechSupported ? (
          <button
            type="button"
            className={`btn btn-sm min-h-12 gap-2 ${listening ? "btn-error" : "btn-outline"}`}
            aria-pressed={listening}
            onClick={() => (listening ? stopListening() : startListening())}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {listening ? "Stop" : "Voice"}
          </button>
        ) : null}
      </div>

      {!speechSupported ? (
        <p className="text-sm opacity-70">Voice-to-text is unavailable here — type notes below.</p>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Voice target field">
          {(["symptom", "cause", "action"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`btn btn-xs min-h-10 capitalize ${target === key ? "btn-neutral" : "btn-ghost"}`}
              aria-pressed={target === key}
              onClick={() => setTarget(key)}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {speechError ? <p className="text-sm text-error">{speechError}</p> : null}
      {listening ? (
        <p className="text-sm text-info" aria-live="polite">
          Listening for {target}…
        </p>
      ) : null}

      <label className="form-control w-full">
        <span className="label-text font-medium">Symptom</span>
        <textarea
          className="textarea textarea-bordered min-h-20 text-base"
          value={symptom}
          onChange={(e) => onChange({ symptom: e.target.value, cause, action })}
        />
      </label>
      <label className="form-control w-full">
        <span className="label-text font-medium">Cause</span>
        <textarea
          className="textarea textarea-bordered min-h-20 text-base"
          value={cause}
          onChange={(e) => onChange({ symptom, cause: e.target.value, action })}
        />
      </label>
      <label className="form-control w-full">
        <span className="label-text font-medium">Action taken</span>
        <textarea
          className="textarea textarea-bordered min-h-20 text-base"
          value={action}
          onChange={(e) => onChange({ symptom, cause, action: e.target.value })}
        />
      </label>
      <button type="button" className="btn btn-primary min-h-12 w-full" disabled={busy} onClick={() => void onSave()}>
        Save notes
      </button>
    </section>
  );
}
