import { createServerFn } from "@tanstack/react-start";
import type { LoadResult } from "./types";

export const getDossier = createServerFn({ method: "GET" })
  .validator((input: { refresh?: boolean }) => ({ refresh: Boolean(input?.refresh) }))
  .handler(async ({ data }): Promise<LoadResult> => {
    const { loadDossier } = await import("./scrape.server");
    return loadDossier(data.refresh);
  });
