import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

function Message({ title, body, action }: { title: string; body: string; action: "reload" | "home" }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-ink">
      <span className="text-loss" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-2xl">{title}</h1>
      <p className="max-w-md text-sm break-words text-muted">{body}</p>
      {action === "reload" ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 inline-flex h-11 items-center rounded-full bg-pine px-5 text-sm font-medium text-white"
        >
          Pārlādēt lapu
        </button>
      ) : (
        <a href="/" className="mt-2 inline-flex h-11 items-center rounded-full bg-pine px-5 text-sm font-medium text-white">
          Uz sākumu
        </a>
      )}
    </main>
  );
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const detail = error instanceof Error && error.message ? error.message : typeof error === "string" ? error : "";
  return <Message title="Kaut kas nogāja greizi" body={detail || "Mēģini pārlādēt lapu."} action="reload" />;
}

export function NotFoundComponent() {
  return <Message title="Lapa nav atrasta" body="Šādas lapas te nav. Valtera šaha statistika ir sākumlapā." action="home" />;
}
