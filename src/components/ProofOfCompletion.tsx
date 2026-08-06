"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Check, PenLine, RotateCcw, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { humanizeFieldError } from "@/lib/technician-field";

export type CompletionProofRequirement =
  | "photo_or_signature"
  | "photo"
  | "signature"
  | "both";

type PhotoProof = {
  blob: Blob;
  previewUrl: string;
  capturedAt: string;
};

type Props = {
  jobId: string;
  technicianId: string;
  requirement: CompletionProofRequirement;
  onCancel: () => void;
  onCompleted: () => void | Promise<void>;
};

const MAX_PHOTO_BYTES = 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;

function requirementText(requirement: CompletionProofRequirement) {
  if (requirement === "both") {
    return "Customer must sign off (initials or signature) and a finished-work photo is required.";
  }
  if (requirement === "photo") return "This job requires a finished-work photo.";
  if (requirement === "signature") {
    return "Ask the customer to sign off with their initials or signature before leaving.";
  }
  return "Ask the customer to sign off with initials or a signature. A finished-work photo is optional.";
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Unable to process this photo."))),
      "image/jpeg",
      quality,
    );
  });
}

async function compressPhoto(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a valid image file.");
  }

  const image = await createImageBitmap(file);
  let scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(image.width, image.height));
  let quality = 0.82;
  let compressed: Blob | null = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is unavailable on this device.");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    compressed = await canvasToBlob(canvas, quality);
    if (compressed.size <= MAX_PHOTO_BYTES) break;

    if (quality > 0.5) quality -= 0.1;
    else scale *= 0.8;
  }

  image.close();
  if (!compressed || compressed.size > MAX_PHOTO_BYTES) {
    throw new Error("The photo could not be compressed below 1 MB. Try another photo.");
  }
  return compressed;
}

export function ProofOfCompletion({
  jobId,
  technicianId,
  requirement,
  onCancel,
  onCompleted,
}: Props) {
  const supabase = createClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);

  // Prefer customer sign-off first (initials or signature) unless photo-only.
  const [activeTab, setActiveTab] = useState<"photo" | "signature">(
    requirement === "photo" ? "photo" : "signature",
  );
  const [signMethod, setSignMethod] = useState<"signature" | "initials">("signature");
  const [initials, setInitials] = useState("");
  const [photo, setPhoto] = useState<PhotoProof | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signatureCapturedAt, setSignatureCapturedAt] = useState<string | null>(null);
  const [signKind, setSignKind] = useState<"signature" | "initials" | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const requiresPhoto = requirement === "photo" || requirement === "both";
  const requiresSignature = requirement === "signature" || requirement === "both";
  const proofSatisfied =
    requirement === "both"
      ? Boolean(photo && signatureData)
      : requirement === "photo"
        ? Boolean(photo)
        : requirement === "signature"
          ? Boolean(signatureData)
          : Boolean(photo || signatureData);

  useEffect(() => {
    return () => {
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    };
  }, [photo]);

  useEffect(() => {
    if (!mounted || activeTab !== "signature" || signatureData || signMethod !== "signature") return;

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(canvas.clientWidth || canvas.offsetWidth || 320, 280);
      const height = 260;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.scale(ratio, ratio);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.strokeStyle = "#111827";
      context.lineWidth = 3;
      context.lineCap = "round";
      context.lineJoin = "round";
      hasInkRef.current = false;
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [mounted, activeTab, signatureData, signMethod]);

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function startSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const point = canvasPoint(event);
    const context = canvas?.getContext("2d");
    if (!canvas || !point || !context) return;

    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
    event.preventDefault();
  }

  function drawSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const point = canvasPoint(event);
    const context = canvasRef.current?.getContext("2d");
    if (!point || !context) return;

    context.lineTo(point.x, point.y);
    context.stroke();
    hasInkRef.current = true;
    event.preventDefault();
  }

  function stopSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
    }
    hasInkRef.current = false;
    setSignatureData(null);
    setSignatureCapturedAt(null);
    setSignKind(null);
    setInitials("");
    setError(null);
  }

  function saveSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInkRef.current) {
      setError("Please ask the customer to sign before saving.");
      return;
    }

    const data = canvas.toDataURL("image/png");
    if (data.length <= 1000) {
      setError("Please provide a valid, non-blank signature.");
      return;
    }

    setSignatureData(data);
    setSignatureCapturedAt(new Date().toISOString());
    setSignKind("signature");
    setError(null);
  }

  function saveInitials() {
    const cleaned = initials.trim().toUpperCase().replace(/[^A-Z.]/g, "");
    if (cleaned.length < 1 || cleaned.length > 4) {
      setError("Enter 1–4 letters for the customer’s initials (example: JD).");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 280;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not capture initials on this device.");
      return;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111827";
    context.font = "bold 120px Georgia, 'Times New Roman', serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(cleaned, canvas.width / 2, canvas.height / 2 - 12);
    context.font = "24px system-ui, sans-serif";
    context.fillStyle = "#6b7280";
    context.fillText("Customer initials sign-off", canvas.width / 2, canvas.height - 36);

    const data = canvas.toDataURL("image/png");
    setSignatureData(data);
    setSignatureCapturedAt(new Date().toISOString());
    setSignKind("initials");
    setInitials(cleaned);
    setError(null);
  }

  async function handlePhoto(file?: File) {
    if (!file) return;
    setProcessingPhoto(true);
    setError(null);

    try {
      const blob = await compressPhoto(file);
      setPhoto((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return {
          blob,
          previewUrl: URL.createObjectURL(blob),
          capturedAt: new Date().toISOString(),
        };
      });
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Unable to process this photo.");
    } finally {
      setProcessingPhoto(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function removePhoto() {
    setPhoto((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setError(null);
  }

  async function markCompleted() {
    if (!proofSatisfied) {
      setError("Customer initials or signature required to complete this job.");
      return;
    }

    setSubmitting(true);
    setError(null);
    let uploadedPhotoPath: string | null = null;

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user || user.id !== technicianId) {
        throw new Error("Your session could not be verified. Please sign in again.");
      }

      const proofs: Array<{
        job_id: string;
        type: "photo" | "signature";
        file_url: string | null;
        base64_data: string | null;
        captured_at: string;
        technician_id: string;
      }> = [];

      if (photo) {
        uploadedPhotoPath = `${technicianId}/${jobId}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("job-completion-proofs")
          .upload(uploadedPhotoPath, photo.blob, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (uploadError) throw uploadError;

        proofs.push({
          job_id: jobId,
          type: "photo",
          file_url: uploadedPhotoPath,
          base64_data: null,
          captured_at: photo.capturedAt,
          technician_id: technicianId,
        });
      }

      if (signatureData && signatureCapturedAt) {
        proofs.push({
          job_id: jobId,
          type: "signature",
          file_url: null,
          base64_data: signatureData,
          captured_at: signatureCapturedAt,
          technician_id: technicianId,
        });
      }

      const { error: proofError } = await supabase
        .from("work_order_completion_proofs")
        .insert(proofs);
      if (proofError) {
        if (uploadedPhotoPath) {
          await supabase.storage.from("job-completion-proofs").remove([uploadedPhotoPath]);
        }
        throw proofError;
      }

      const { error: completionError } = await supabase.rpc(
        "complete_technician_work_order",
        { p_job_id: jobId },
      );
      if (completionError) throw completionError;

      await onCompleted();
    } catch (completionError) {
      const raw =
        completionError instanceof Error
          ? completionError.message
          : typeof completionError === "object" &&
              completionError &&
              "message" in completionError
            ? String((completionError as { message: string }).message)
            : "Unable to complete this job. Please try again.";
      setError(humanizeFieldError(raw));
    } finally {
      setSubmitting(false);
    }
  }

  const panel = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-3 sm:p-6"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="proof-of-completion-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border-2 border-base-content/20 bg-base-100 p-4 text-base-content opacity-100 shadow-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="proof-of-completion-title" className="text-2xl font-bold">
          Customer sign-off
        </h2>
        <p className="mt-1 text-base font-medium opacity-80">{requirementText(requirement)}</p>

        <div role="tablist" aria-label="Proof type" className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "signature"}
            className={`btn min-h-14 text-base ${activeTab === "signature" ? "btn-primary" : "btn-outline"}`}
            onClick={() => setActiveTab("signature")}
          >
            <PenLine className="h-5 w-5" />
            Initials / Signature {signatureData ? <Check className="h-5 w-5" aria-label="saved" /> : null}
            {requiresSignature ? <span className="sr-only">required</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "photo"}
            className={`btn min-h-14 text-base ${activeTab === "photo" ? "btn-primary" : "btn-outline"}`}
            onClick={() => setActiveTab("photo")}
          >
            <Camera className="h-5 w-5" />
            Photo {photo ? <Check className="h-5 w-5" aria-label="captured" /> : null}
            {requiresPhoto ? <span className="sr-only">required</span> : null}
          </button>
        </div>

        {activeTab === "photo" ? (
          <section className="mt-4" aria-label="Photo proof">
            {photo ? (
              <div>
                <div className="relative aspect-video overflow-hidden rounded-box border-2 border-base-content/30 bg-base-200">
                  <Image
                    src={photo.previewUrl}
                    alt="Finished work preview"
                    fill
                    unoptimized
                    className="object-contain"
                  />
                </div>
                <button type="button" className="btn btn-outline mt-3 min-h-12 w-full" onClick={removePhoto}>
                  <RotateCcw className="h-5 w-5" />
                  Retake or choose another
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className="btn btn-primary min-h-20 text-base"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={processingPhoto}
                >
                  <Camera className="h-6 w-6" />
                  {processingPhoto ? "Processing…" : "Take Photo"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline min-h-20 text-base"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={processingPhoto}
                >
                  <Upload className="h-6 w-6" />
                  Choose from Device
                </button>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => handlePhoto(event.target.files?.[0])}
                />
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => handlePhoto(event.target.files?.[0])}
                />
              </div>
            )}
            <p className="mt-2 text-sm opacity-70">Photos are resized and compressed below 1 MB before upload.</p>
          </section>
        ) : (
          <section className="mt-4" aria-label="Customer sign-off">
            {signatureData ? (
              <div>
                <p className="mb-2 text-sm font-semibold">
                  Saved customer {signKind === "initials" ? "initials" : "signature"}
                </p>
                <div className="relative h-[260px] overflow-hidden rounded-box border-2 border-base-content/40 bg-white">
                  <Image
                    src={signatureData}
                    alt={signKind === "initials" ? "Saved customer initials" : "Saved customer signature"}
                    fill
                    unoptimized
                    className="object-contain"
                  />
                </div>
                <button type="button" className="btn btn-outline mt-3 min-h-12 w-full" onClick={clearSignature}>
                  Clear and capture again
                </button>
              </div>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label="Sign-off method">
                  <button
                    type="button"
                    className={`btn min-h-12 ${signMethod === "signature" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => {
                      setSignMethod("signature");
                      setError(null);
                    }}
                  >
                    Signature
                  </button>
                  <button
                    type="button"
                    className={`btn min-h-12 ${signMethod === "initials" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => {
                      setSignMethod("initials");
                      setError(null);
                    }}
                  >
                    Initials
                  </button>
                </div>

                {signMethod === "initials" ? (
                  <div className="space-y-3">
                    <label className="form-control">
                      <span className="label-text font-semibold">Customer initials</span>
                      <input
                        className="input input-bordered input-lg mt-1 w-full text-center text-2xl font-bold tracking-[0.3em] uppercase"
                        value={initials}
                        maxLength={4}
                        placeholder="JD"
                        autoComplete="off"
                        onChange={(event) =>
                          setInitials(event.target.value.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 4))
                        }
                      />
                    </label>
                    <p className="text-sm opacity-70">
                      Have the customer type their initials (1–4 letters), then save the sign-off.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button" className="btn btn-outline min-h-12" onClick={clearSignature}>
                        Clear
                      </button>
                      <button type="button" className="btn btn-primary min-h-12" onClick={saveInitials}>
                        Save initials
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mb-2 text-sm font-semibold">Customer signature pad</p>
                    <canvas
                      ref={canvasRef}
                      className="h-[260px] w-full touch-none rounded-box border-2 border-base-content/50 bg-white"
                      style={{ backgroundColor: "#ffffff", touchAction: "none" }}
                      onPointerDown={startSignature}
                      onPointerMove={drawSignature}
                      onPointerUp={stopSignature}
                      onPointerCancel={stopSignature}
                      aria-label="Signature pad"
                    />
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <button type="button" className="btn btn-outline min-h-12" onClick={clearSignature}>
                        Clear
                      </button>
                      <button type="button" className="btn btn-primary min-h-12" onClick={saveSignature}>
                        Save signature
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {error ? (
          <div role="alert" className="alert alert-error mt-4">
            <span>{error}</span>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" className="btn min-h-14 text-base" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-success min-h-14 text-base"
            onClick={markCompleted}
            disabled={!proofSatisfied || submitting || processingPhoto}
          >
            {submitting ? "Completing…" : "Submit sign-off & complete"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(panel, document.body);
}
