import { Sparkles } from "lucide-react";
import type { Provenance } from "@/domain/types";
import { needsDisclosure, PROVENANCE_LABELS } from "@/lib/workspaceSteps";

/** Disclosure chip for AI-edited or AI-generated images; renders nothing for real photos. */
export function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  if (!needsDisclosure(provenance)) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-950 ring-1 ring-violet-700/30">
      <Sparkles className="size-3.5" aria-hidden="true" />
      {PROVENANCE_LABELS[provenance]}
    </span>
  );
}
