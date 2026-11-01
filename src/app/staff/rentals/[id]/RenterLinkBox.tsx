import { CopyButton } from "@/components/CopyButton";
import { signRenterToken } from "@/lib/authTokens";
import { getEnv } from "@/lib/env";
import { authSecrets } from "@/server/auth";

/** A fresh renter link (token for this rental only) for staff to hand over; staff-only page. */
export function RenterLinkBox({ rentalId, intro }: { rentalId: string; intro: string }) {
  const link = `${getEnv().APP_BASE_URL ?? ""}/r/${signRenterToken(authSecrets().renterLinkSecret, rentalId).token}`;
  return (
    <section aria-label="Renter link" className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-sm">{intro}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">{link}</code>
        <CopyButton text={link} label="Copy renter link" />
      </div>
    </section>
  );
}
