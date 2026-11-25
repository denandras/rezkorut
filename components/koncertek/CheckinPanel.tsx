"use client";

import { useEffect, useRef, useState } from "react";

import { formatTimestampHu, type CheckinResponse } from "./types";

/**
 * Door check-in panel. The code input is big, auto-uppercases and strips
 * spaces and dashes; submit POSTs /api/intern/checkin and the result panel
 * shows the five outcomes. Camera scanning uses BarcodeDetector when the
 * browser has it (behind a „Kamera” button) — no barcode library, plain text
 * input is always available. The live counter shows used / total sold.
 */

type ScanState =
  | { kind: "none" }
  | { kind: "valid"; type: string; code: string; buyer: string | null }
  | { kind: "used"; time: string | null; code: string }
  | { kind: "void"; code: string }
  | { kind: "wrong_concert"; code: string }
  | { kind: "unknown"; code: string };

type CameraState = "off" | "starting" | "on" | "denied";

/** The DOM lib has no BarcodeDetector types — declare the minimal shape. */
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

const RESULT_CLASS: Record<ScanState["kind"], string> = {
  none: "",
  valid: "border-[#86e3a0]/50 bg-[#86e3a0]/10 text-[#86e3a0]",
  used: "border-[#e6be5f]/50 bg-[#e6be5f]/10 text-[#e6be5f]",
  void: "border-[#ed9a91]/40 bg-[#ed9a91]/10 text-[#ed9a91]",
  wrong_concert: "border-[#ed9a91]/40 bg-[#ed9a91]/10 text-[#ed9a91]",
  unknown: "border-[#ed9a91]/40 bg-[#ed9a91]/10 text-[#ed9a91]",
};

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, "");
}

export default function CheckinPanel({
  concertId,
  initialCounts,
}: {
  concertId: string;
  initialCounts: { used: number; sold: number };
}) {
  const [code, setCode] = useState("");
  const [scan, setScan] = useState<ScanState>({ kind: "none" });
  const [counts, setCounts] = useState(initialCounts);
  const [submitting, setSubmitting] = useState(false);
  const [camera, setCamera] = useState<CameraState>("off");
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeRef = useRef("");
  const submittingRef = useRef(false);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);
  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  function stopCamera() {
    if (detectorTimer.current) {
      clearInterval(detectorTimer.current);
      detectorTimer.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCamera("off");
  }

  useEffect(() => stopCamera, []);

  function submitCode(rawCode: string) {
    const normalized = normalizeCode(rawCode);
    if (normalized.length === 0 || submittingRef.current) return;
    setSubmitting(true);
    fetch("/api/intern/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concert_id: concertId, code: normalized }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as CheckinResponse | null;
        setSubmitting(false);
        if (!response.ok || !data) {
          setScan({ kind: "unknown", code: normalized });
          return;
        }
        if (data.counts) setCounts(data.counts);
        switch (data.result) {
          case "valid":
            setScan({
              kind: "valid",
              type: data.ticket?.ticket_type_name ?? "jegy",
              code: data.ticket?.code ?? normalized,
              buyer: data.ticket?.buyer_name ?? null,
            });
            break;
          case "used":
            setScan({
              kind: "used",
              time: data.ticket?.used_at ?? null,
              code: data.ticket?.code ?? normalized,
            });
            break;
          case "void":
            setScan({ kind: "void", code: data.ticket?.code ?? normalized });
            break;
          case "wrong_concert":
            setScan({ kind: "wrong_concert", code: data.ticket?.code ?? normalized });
            break;
          case "unknown":
          default:
            setScan({ kind: "unknown", code: normalized });
            break;
        }
      })
      .catch(() => {
        setSubmitting(false);
        setScan({ kind: "unknown", code: normalized });
      });
    setCode("");
  }

  async function startCamera() {
    const Ctor = (window as unknown as { BarcodeDetector?: new () => BarcodeDetectorLike })
      .BarcodeDetector;
    if (!Ctor) {
      setCameraNote("Ez a böngésző nem támogatja a kamerás beolvasást – gépelje be a kódot.");
      return;
    }
    setCamera("starting");
    setCameraNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCamera("on");

      const detector = new Ctor();
      detectorTimer.current = setInterval(async () => {
        try {
          if (!videoRef.current || codeRef.current.length > 0 || submittingRef.current) return;
          const hits = await detector.detect(videoRef.current);
          const value = hits.find((hit) => hit.rawValue)?.rawValue;
          if (value) submitCode(value);
        } catch {
          /* a single failed frame is fine, the interval tries again */
        }
      }, 400);
    } catch {
      setCamera("off");
      setCameraNote("Nem sikerült elérni a kamerát – gépelje be a kódot.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Élő számláló */}
      <div className="rounded-xl border border-neutral-border bg-neutral-dark/60 px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-neutral-400">Beléptetve</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-neutral-100">
          {counts.used} <span className="text-neutral-500">/ {counts.sold} eladott</span>
        </p>
      </div>

      {/* Kódbevitel */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitCode(code);
        }}
        className="rounded-xl border border-neutral-border bg-neutral-dark/60 p-4"
      >
        <label
          htmlFor="checkin-code"
          className="block text-xs uppercase tracking-wider text-neutral-400"
        >
          Jegykód beolvasása
        </label>
        <input
          id="checkin-code"
          type="text"
          value={code}
          onChange={(event) => setCode(normalizeCode(event.target.value))}
          onFocus={(event) => event.target.select()}
          placeholder="7Q2M4Z9PKX"
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className={`mt-2 w-full rounded-xl border border-neutral-border bg-charcoal px-4 py-4 text-center text-2xl font-bold uppercase tracking-[0.25em] text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-primary ${
            submitting ? "opacity-70" : ""
          }`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-[#0b1a10] transition-opacity hover:opacity-90"
          >
            Beolvasás
          </button>
          {camera === "off" || camera === "denied" ? (
            <button
              type="button"
              onClick={startCamera}
              className="rounded-lg border border-neutral-border bg-neutral-dark px-4 py-3 text-sm font-medium text-neutral-200 transition-colors hover:border-primary/50 hover:text-primary"
            >
              Kamera
            </button>
          ) : (
            <button
              type="button"
              onClick={stopCamera}
              className="rounded-lg border border-neutral-border bg-neutral-dark px-4 py-3 text-sm font-medium text-neutral-200 transition-colors hover:border-primary/50 hover:text-primary"
            >
              Kamera leállítása
            </button>
          )}
        </div>
        {cameraNote && <p className="mt-2 text-xs text-neutral-400">{cameraNote}</p>}
        {camera === "on" && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="mt-3 aspect-video w-full rounded-lg border border-neutral-border bg-charcoal"
          />
        )}
      </form>

      {/* Eredmény */}
      {scan.kind !== "none" && (
        <div
          role="status"
          className={`rounded-xl border p-5 ${RESULT_CLASS[scan.kind]}`}
        >
          {scan.kind === "valid" && (
            <>
              <p className="text-lg font-bold">
                Érvényes jegy – {scan.type}, {scan.code}
              </p>
              {scan.buyer && <p className="mt-1 text-sm opacity-90">{scan.buyer}</p>}
            </>
          )}
          {scan.kind === "used" && (
            <p className="text-lg font-bold">
              Már beolvasva{scan.time ? `: ${formatTimestampHu(scan.time)}` : ""}
              {scan.code ? ` – ${scan.code}` : ""}
            </p>
          )}
          {scan.kind === "void" && (
            <p className="text-lg font-bold">
              Visszaváltott jegy{scan.code ? ` – ${scan.code}` : ""}
            </p>
          )}
          {scan.kind === "wrong_concert" && (
            <p className="text-lg font-bold">
              Másik koncertre szól{scan.code ? ` – ${scan.code}` : ""}
            </p>
          )}
          {scan.kind === "unknown" && (
            <p className="text-lg font-bold">Ismeretlen kód</p>
          )}
        </div>
      )}
    </div>
  );
}
