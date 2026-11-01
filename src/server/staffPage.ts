import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isStaff, STAFF_COOKIE } from "./auth";

/** For staff pages: the proxy redirects too, but pages that read data check the session themselves. */
export async function requireStaffPage(returnTo: string): Promise<void> {
  const jar = await cookies();
  if (!isStaff(jar.get(STAFF_COOKIE)?.value)) redirect(`/staff/login?next=${encodeURIComponent(returnTo)}`);
}
