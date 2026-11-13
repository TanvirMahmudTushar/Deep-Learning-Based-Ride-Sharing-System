"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Check, Loader2, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SPRING_UI } from "@/components/ui/motion";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

export function SelfieCaptureDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [useAsProfile, setUseAsProfile] = useState(true);
  const [uploading, setUploading] = useState(false);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  useEffect(() => {
    if (!open || capturedBlob) {
      stopStream();
      return;
    }
    let cancelled = false;
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Live camera unavailable here. You can still take or choose a photo below.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError("Camera permission not granted. Use the button below to take or upload a clear selfie.");
        }
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, capturedBlob]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 640;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setCapturedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        stopStream();
      },
      "image/jpeg",
      0.9,
    );
  }

  function handleFilePick(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
    stopStream();
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
  }

  async function submitSelfie() {
    if (!capturedBlob) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("doc_type", "photo");
      form.append("use_as_profile_photo", useAsProfile ? "true" : "false");
      form.append("file", capturedBlob, capturedBlob instanceof File ? capturedBlob.name : "selfie.jpg");
      await api("/api/rider/documents", { method: "POST", body: form });
      toast.success(useAsProfile ? "Selfie uploaded & set as profile photo" : "Selfie uploaded for verification");
      retake();
      onUploaded();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload selfie");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          stopStream();
          retake();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Clear Face Selfie</DialogTitle>
          <DialogDescription>Centre your face in good lighting with no sunglasses or mask.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative mx-auto aspect-square w-64 overflow-hidden rounded-full border-2 border-primary/60 bg-muted shadow-inner">
            {previewUrl ? (
              <motion.img
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={SPRING_UI}
                src={previewUrl}
                alt="Selfie preview"
                className="size-full object-cover"
              />
            ) : cameraError ? (
              <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
                <Camera className="size-8 text-muted-foreground/70" />
                <span>{cameraError}</span>
              </div>
            ) : (
              <>
                <video ref={videoRef} playsInline muted className="size-full -scale-x-100 object-cover" />
                {!cameraReady && (
                  <div className="absolute inset-0 grid place-items-center bg-muted/70">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3.5 py-2.5">
            <div className="min-w-0">
              <div className="text-xs font-semibold">Use this selfie as profile photo</div>
              <div className="text-[11px] text-muted-foreground">No separate profile photo upload needed</div>
            </div>
            <Switch checked={useAsProfile} onCheckedChange={setUseAsProfile} aria-label="Use selfie as profile photo" />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFilePick(e.target.files[0])}
          />
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {!capturedBlob ? (
            <>
              {cameraReady && (
                <Button type="button" className="h-11 w-full" onClick={captureFrame}>
                  <Camera /> Capture Selfie
                </Button>
              )}
              <Button type="button" variant={cameraReady ? "outline" : "default"} className="h-11 w-full" onClick={() => fileInputRef.current?.click()}>
                <Upload /> {cameraReady ? "Or Choose Photo" : "Take / Choose Selfie"}
              </Button>
            </>
          ) : (
            <div className="flex w-full gap-2">
              <Button type="button" variant="outline" className="h-11 flex-1" disabled={uploading} onClick={retake}>
                <RefreshCw /> Retake
              </Button>
              <Button type="button" className="h-11 flex-1" disabled={uploading} onClick={() => void submitSelfie()}>
                {uploading ? <Loader2 className="animate-spin" /> : <Check />} Submit Selfie
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

