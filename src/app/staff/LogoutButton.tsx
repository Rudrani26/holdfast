"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch("/api/staff/logout", { method: "POST" }).catch(() => undefined);
        router.replace("/staff/login");
        router.refresh();
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
