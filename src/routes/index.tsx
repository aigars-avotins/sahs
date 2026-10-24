import { createFileRoute } from "@tanstack/react-router";
import { ValtersApp, ValtersPending } from "@/components/valters-app";
import { getDossier } from "@/lib/chess/dossier";

export const Route = createFileRoute("/")({
  loader: () => getDossier({ data: { refresh: false } }),
  pendingComponent: ValtersPending,
  pendingMs: 200,
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  return <ValtersApp initial={initial} />;
}
