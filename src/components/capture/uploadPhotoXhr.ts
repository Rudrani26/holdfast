import type { PhotoPhase, Provenance } from "@/domain/types";

export interface UploadResult {
  photoId: string;
  sha256: string;
  rentalStatus: string;
}

/** POSTs one photo with upload progress (fetch has no upload progress events). */
export function uploadPhotoXhr(
  rentalId: string,
  fields: { phase: PhotoPhase; angleId: string; provenance: Provenance },
  file: File,
  onProgress: (fraction: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("phase", fields.phase);
    form.set("angleId", fields.angleId);
    form.set("provenance", fields.provenance);
    form.set("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/rentals/${encodeURIComponent(rentalId)}/photos`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as (UploadResult & { error?: { message?: string } }) | null;
      if (xhr.status === 201 && body?.photoId) resolve(body);
      else reject(new Error(body?.error?.message ?? `Upload failed (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload. Check the connection and retry."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Retry."));
    xhr.timeout = 120_000;
    xhr.send(form);
  });
}
