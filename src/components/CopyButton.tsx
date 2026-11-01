"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({
  text,
  label = "Copy",
  size = "default",
  ariaLabel,
}: {
  text: string;
  label?: string;
  size?: "default" | "xs";
  /** Accessible name when the visible label alone is ambiguous (e.g. several "Copy" buttons). */
  ariaLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      aria-label={ariaLabel}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setState("copied"),
          () => setState("failed"),
        )
      }
    >
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed: select the text" : label}</span>
    </Button>
  );
}
