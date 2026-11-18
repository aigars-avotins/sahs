import { createServerFn } from "@tanstack/react-start";
import type { LoadResult } from "./types";

export const getDossier = createServerFn({ method: "GET" }).handler(async (): Promise<LoadResult> => {
  const { loadDossier } = await import("./scrape.server");
  return loadDossier();
});
