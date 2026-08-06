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

function NoteField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold leading-none">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        className="textarea textarea-bordered w-full resize-y text-base leading-relaxed"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
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
    <section className="space-y-4" aria-labelledby="diagnostic-notes-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="diagnostic-notes-heading" className="text-base font-semibold leading-tight">
            Diagnostic notes
          </h3>
          <p className="mt-0.5 text-sm opacity-70">
            Symptom → Cause → Action. Saves to the work order (managers see the same notes).
          </p>
        </div>
        {speechSupported ? (
          <button
            type="button"
            className={`btn btn-sm shrink-0 gap-2 ${listening ? "btn-error" : "btn-outline"}`}
            aria-pressed={listening}
            onClick={() => (listening ? stopListening() : startListening())}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {listening ? "Stop" : "Voice"}
          </button>
        ) : null}
      </div>

      {speechSupported ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Voice target field">
          <span className="text-xs font-medium uppercase tracking-wide opacity-60">Dictate into</span>
          {(
            [
              { key: "symptom", label: "Symptom" },
              { key: "cause", label: "Cause" },
              { key: "action", label: "Action" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              className={`btn btn-sm capitalize ${target === item.key ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={target === item.key}
              onClick={() => setTarget(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm opacity-70">Voice-to-text is unavailable here — type notes below.</p>
      )}

      {speechError ? (
        <p className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error" role="alert">
          {speechError}
        </p>
      ) : null}
      {listening ? (
        <p className="rounded-lg bg-info/10 px-3 py-2 text-sm text-info" aria-live="polite">
          Listening for {target}…
        </p>
      ) : null}

      <div className="grid gap-4">
        <NoteField
          id="diag-symptom"
          label="Symptom"
          value={symptom}
          placeholder="What the customer reported / what you observed"
          onChange={(value) => onChange({ symptom: value, cause, action })}
        />
        <NoteField
          id="diag-cause"
          label="Cause"
          value={cause}
          placeholder="Root cause or diagnosis"
          onChange={(value) => onChange({ symptom, cause: value, action })}
        />
        <NoteField
          id="diag-action"
          label="Action taken"
          value={action}
          placeholder="Work performed / parts installed / next steps"
          rows={4}
          onChange={(value) => onChange({ symptom, cause, action: value })}
        />
      </div>

      <button
        type="button"
        className="btn btn-primary min-h-12 w-full sm:w-auto sm:min-w-[12rem]"
        disabled={busy}
        onClick={() => void onSave()}
      >
        {busy ? "Saving…" : "Save notes"}
      </button>
    </section>
  );
}
