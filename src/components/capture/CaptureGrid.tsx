"use client";

import { Camera, CheckCircle2, RotateCcw } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { PROVENANCES, type Angle, type PhotoPhase, type Provenance } from "@/domain/types";
import { PROVENANCE_LABELS } from "@/lib/workspaceSteps";
import { ProvenanceChip } from "./ProvenanceChip";
import { uploadPhotoXhr } from "./uploadPhotoXhr";

export interface ExistingPhoto {
  angleId: string;
  sha256: string;
  provenance: Provenance;
}

interface Props {
  rentalId: string;
  phase: Extract<PhotoPhase, "CHECKOUT" | "CHECKIN">;
  angles: Angle[];
  photos: ExistingPhoto[];
}

/** Guided capture: one tile per angle, camera or file input, progress, retake, provenance. */
export function CaptureGrid({ rentalId, phase, angles, photos }: Props) {
  const done = angles.filter((a) => photos.some((p) => p.angleId === a.id)).length;
  return (
    <section aria-labelledby="capture-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="capture-heading" className="text-lg font-semibold">
          {phase === "CHECKOUT" ? "Check-out photos" : "Return photos"}
        </h2>
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {done} of {angles.length} angles
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {phase === "CHECKOUT"
          ? "Photograph each angle before the item leaves. These become the renter's baseline."
          : "Photograph the same angles as at check-out, from the same distance and direction."}
      </p>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {angles.map((angle) => (
          <li key={angle.id}>
            <AngleTile rentalId={rentalId} phase={phase} angle={angle} existing={photos.find((p) => p.angleId === angle.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

type TileState = { kind: "idle" } | { kind: "uploading"; progress: number } | { kind: "error"; message: string };

function AngleTile({ rentalId, phase, angle, existing }: { rentalId: string; phase: Props["phase"]; angle: Angle; existing?: ExistingPhoto }) {
  const router = useRouter();
  const id = useId();
  const [provenance, setProvenance] = useState<Provenance>(existing?.provenance ?? "UPLOADED_REAL");
  const [state, setState] = useState<TileState>({ kind: "idle" });
  const uploading = state.kind === "uploading";

  async function onFile(file: File | undefined) {
    if (!file) return;
    setState({ kind: "uploading", progress: 0 });
    try {
      await uploadPhotoXhr(rentalId, { phase, angleId: angle.id, provenance }, file, (progress) => setState({ kind: "uploading", progress }));
      setState({ kind: "idle" });
      router.refresh(); // new thumbnail, step progress, timeline
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Upload failed." });
    }
  }

  const photoUrl = existing && `/api/rentals/${rentalId}/photos/${phase}_${angle.id}?v=${existing.sha256.slice(0, 12)}`;

  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-lg border">
      <div className="relative aspect-[4/3] bg-muted">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={`${phase === "CHECKOUT" ? "Check-out" : "Return"} photo: ${angle.label}`}
            fill
            unoptimized
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <p className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">{angle.hint}</p>
        )}
        {uploading && <div className="absolute inset-0 bg-background/60" aria-hidden="true" />}
      </div>
      <figcaption className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{angle.label}</span>
          {existing && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-900">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Uploaded
            </span>
          )}
        </div>
        {existing && <p className="text-xs text-muted-foreground">{angle.hint}</p>}
        {existing && <ProvenanceChip provenance={existing.provenance} />}

        <label htmlFor={`${id}-prov`} className="mt-auto text-xs font-medium">
          Photo source
        </label>
        <select
          id={`${id}-prov`}
          value={provenance}
          onChange={(e) => setProvenance(e.target.value as Provenance)}
          disabled={uploading}
          className="h-9 rounded-md border bg-background px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {PROVENANCES.map((p) => (
            <option key={p} value={p}>
              {PROVENANCE_LABELS[p]}
            </option>
          ))}
        </select>

        {/* The visible label is the control; the input is visually hidden but keyboard-reachable. */}
        <label
          className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-medium has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
            existing ? "border bg-background hover:bg-muted" : "bg-primary text-primary-foreground hover:bg-primary/90"
          } ${uploading ? "pointer-events-none opacity-50" : ""}`}
        >
          {existing ? <RotateCcw className="size-4" aria-hidden="true" /> : <Camera className="size-4" aria-hidden="true" />}
          {existing ? "Retake" : "Take or choose photo"}
          <span className="sr-only"> for {angle.label}</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = ""; // allow choosing the same file again after an error
            }}
          />
        </label>

        {uploading && (
          <div className="flex items-center gap-2 text-xs" role="status">
            <progress value={state.progress} max={1} className="h-2 flex-1" aria-label={`Uploading ${angle.label}`} />
            <span className="tabular-nums">{state.progress < 1 ? `${Math.round(state.progress * 100)}%` : "Processing…"}</span>
          </div>
        )}
        {state.kind === "error" && (
          <p role="alert" className="text-xs text-destructive">
            {state.message}
          </p>
        )}
      </figcaption>
    </figure>
  );
}
