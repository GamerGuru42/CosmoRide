"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";

interface CameraScannerProps {
  onScan: (token: string) => void;
  isPaused?: boolean;
}

export function CameraScanner({ onScan, isPaused = false }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [manualToken, setManualToken] = useState<string>("");
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Stop camera tracks cleanly
  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    setIsScanning(false);
    setTorchOn(false);
  }, []);

  // Start camera stream
  const startCamera = useCallback(async () => {
    stopCamera();
    setErrorMessage(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setHasPermission(false);
      setErrorMessage("Camera access is not supported by this browser.");
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setHasPermission(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play();
      }

      // Check for torch capability
      const track = stream.getVideoTracks()[0];
      if (track) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const capabilities = (track as any).getCapabilities?.() || {};
        if ("torch" in capabilities) {
          setHasTorch(true);
        }
      }

      setIsScanning(true);
    } catch (err: unknown) {
      setHasPermission(false);
      const msg = err instanceof Error ? err.message : "Failed to access camera.";
      setErrorMessage(
        msg.includes("Permission denied") || msg.includes("NotAllowedError")
          ? "Camera permission was denied. Please allow camera access in your browser settings."
          : `Camera error: ${msg}`
      );
    }
  }, [stopCamera]);

  // Toggle flashlight / torch
  async function toggleTorch() {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !torchOn;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
    } catch {
      // ignore
    }
  }

  // Scan frame loop using requestAnimationFrame + jsQR
  useEffect(() => {
    if (!isScanning || isPaused) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let active = true;

    function tick() {
      if (!active || isPaused) return;

      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas!.height = video.videoHeight;
        canvas!.width = video.videoWidth;
        ctx!.drawImage(video, 0, 0, canvas!.width, canvas!.height);

        const imageData = ctx!.getImageData(0, 0, canvas!.width, canvas!.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          // Haptic feedback
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            try {
              navigator.vibrate([40, 30, 40]);
            } catch {
              // ignore
            }
          }

          let token = code.data.trim();
          // Check if payload is JSON: {"token":"...","booking_id":"..."}
          try {
            if (token.startsWith("{") && token.endsWith("}")) {
              const parsed = JSON.parse(token);
              if (parsed.token) {
                token = String(parsed.token).trim();
              }
            }
          } catch {
            // treat as raw token
          }

          if (token.length > 0) {
            onScan(token);
            // Will pause via isPaused prop
            return;
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      active = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isScanning, isPaused, onScan]);

  // Initial mount: start camera
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualToken.trim()) return;
    onScan(manualToken.trim());
    setManualToken("");
  }

  return (
    <div className="w-full space-y-4">
      {/* Video Viewfinder Container */}
      <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl bg-black shadow-lg">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />
        {/* Hidden canvas for image data processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder Target Overlays */}
        {isScanning && !isPaused && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Darkened vignette around target */}
            <div className="relative h-64 w-64 rounded-2xl border-2 border-white/60 shadow-2xl">
              {/* Corner brackets */}
              <div className="absolute -top-1 -left-1 h-6 w-6 border-t-4 border-l-4 border-[#20A477] rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 h-6 w-6 border-t-4 border-r-4 border-[#20A477] rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 h-6 w-6 border-b-4 border-l-4 border-[#20A477] rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 h-6 w-6 border-b-4 border-r-4 border-[#20A477] rounded-br-lg" />

              {/* Animated laser scan bar */}
              <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-[#20A477] to-transparent animate-pulse" />
            </div>
          </div>
        )}

        {/* Paused state indicator */}
        {isPaused && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs">
            <span className="text-xs font-bold text-white uppercase tracking-wider bg-[#102D4A] px-3 py-1.5 rounded-full">
              Scanner Paused (Verifying)
            </span>
          </div>
        )}

        {/* Torch Toggle Button */}
        {hasTorch && (
          <button
            type="button"
            onClick={toggleTorch}
            className={`absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full text-white shadow-md transition-all ${
              torchOn ? "bg-[#E5A13B]" : "bg-black/50 hover:bg-black/70"
            }`}
            title="Toggle Flashlight"
            aria-label="Toggle Flashlight"
          >
            <span className="text-lg">{torchOn ? "🔦" : "💡"}</span>
          </button>
        )}

        {/* Permission / Error Fallback Overlay */}
        {hasPermission === false && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 p-6 text-center text-white">
            <span className="text-3xl mb-2">📷</span>
            <p className="text-sm font-semibold text-rose-300 mb-2">
              Camera Unavailable
            </p>
            <p className="text-xs text-slate-300 max-w-xs mb-4">
              {errorMessage || "Camera access was denied. You can manually enter student ticket tokens below."}
            </p>
            <button
              type="button"
              onClick={startCamera}
              className="rounded-xl bg-[#20A477] px-4 py-2 text-xs font-bold text-white hover:bg-[#1b8a64] transition-colors"
            >
              Retry Camera Access
            </button>
          </div>
        )}
      </div>

      {/* Manual Input Fallback */}
      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <input
          type="text"
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          placeholder="Manual Ticket Code (e.g. CU-TKT-1082...)"
          className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-mono font-medium text-[#102D4A] placeholder-slate-400 focus:outline-none focus:border-[#102D4A]"
        />
        <button
          type="submit"
          disabled={!manualToken.trim()}
          className="rounded-xl bg-[#102D4A] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#0b1f33] disabled:opacity-40 transition-colors"
        >
          Verify Pass
        </button>
      </form>
    </div>
  );
}
