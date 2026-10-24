export type PreviewHostBridgeOptions = {
  navigate?: (path: string) => void;
  getRoutePaths?: () => string[];
};

export function installPreviewHostBridge(_options?: PreviewHostBridgeOptions) {
  return () => {};
}

export function collectRoutePathsFromTree(_tree?: unknown): string[] {
  return ["/"];
}
