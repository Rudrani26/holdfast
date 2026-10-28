import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "./LogoutButton";

export const metadata = { title: "Staff · Holdfast" };

// Placeholder landing page behind the staff session (src/proxy.ts). The rentals list and workspace
// arrive in later tasks.
export default function StaffHomePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">Staff workspace</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Signed in. Rentals will appear here.</p>
          <LogoutButton />
        </CardContent>
      </Card>
    </main>
  );
}
