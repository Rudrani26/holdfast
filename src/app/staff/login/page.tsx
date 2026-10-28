import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Staff sign in · Holdfast" };

export default function StaffLoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">Staff sign in</h1>
          </CardTitle>
          <CardDescription>Kestrel Gear Rentals (demo) · Holdfast</CardDescription>
        </CardHeader>
        <CardContent>
          {/* useSearchParams needs a Suspense boundary under Cache Components. */}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
