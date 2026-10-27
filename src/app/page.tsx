import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Badge variant="outline" className="mb-2">
            Sandbox demo — no real money
          </Badge>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">Holdfast</h1>
          </CardTitle>
          <CardDescription>
            Rental deposits settled fairly, with evidence, on PayPal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Project scaffold. The storefront arrives in a later milestone.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
