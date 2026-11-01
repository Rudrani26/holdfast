import Image from "next/image";

export interface PairPhoto {
  url: string;
  width: number;
  height: number;
}

export interface OverlayBox {
  id: string;
  /** [ymin, xmin, ymax, xmax], 0–1000, on the return image (AI_PIPELINE.md §4). */
  box: [number, number, number, number];
  tone: "new" | "review" | "existing";
  label: string;
}

const TONE = {
  new: "border-red-600 bg-red-600/10",
  review: "border-amber-500 bg-amber-500/10",
  existing: "border-sky-600 bg-sky-600/5 border-dashed",
} as const;

/** Check-out and return photo side by side; finding boxes are drawn over the return photo. */
export function PhotoPair({ angleLabel, before, after, boxes = [] }: { angleLabel: string; before?: PairPhoto; after?: PairPhoto; boxes?: OverlayBox[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        { photo: before, caption: "Check-out", overlay: false },
        { photo: after, caption: "Return", overlay: true },
      ].map(({ photo, caption, overlay }) => (
        <figure key={caption} className="flex flex-col gap-1">
          <div className="relative overflow-hidden rounded-md border bg-muted">
            {photo ? (
              <Image
                src={photo.url}
                alt={`${caption} photo: ${angleLabel}`}
                width={photo.width}
                height={photo.height}
                unoptimized
                className="h-auto w-full"
              />
            ) : (
              <p className="flex aspect-[4/3] items-center justify-center text-xs text-muted-foreground">No photo</p>
            )}
            {overlay &&
              photo &&
              boxes.map((b) => {
                const [ymin, xmin, ymax, xmax] = b.box.map((v) => Math.min(1000, Math.max(0, v)) / 10) as [number, number, number, number];
                return (
                  <span
                    key={b.id}
                    className={`absolute rounded-sm border-2 ${TONE[b.tone]}`}
                    style={{ top: `${ymin}%`, left: `${xmin}%`, height: `${Math.max(ymax - ymin, 1)}%`, width: `${Math.max(xmax - xmin, 1)}%` }}
                    title={b.label}
                  >
                    <span className="sr-only">{b.label}</span>
                  </span>
                );
              })}
          </div>
          <figcaption className="text-xs text-muted-foreground">
            {caption} · {angleLabel}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
