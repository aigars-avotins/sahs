/** Chess-results load-balances requests onto its numbered S-node hosts. */
/**
 * A link taken from scraped HTML, made absolute and kept only if it points to chess-results
 * over HTTPS; anything else becomes the site's home page. Used for every outgoing link we render.
 */
export function chessResultsHref(href: string | undefined): string {
  const home = "https://chess-results.com/";
  if (!href) return home;
  try {
    const url = new URL(href.replace(/^\.\//, ""), home);
    if (url.protocol === "http:" && /^(?:www\.|s\d+\.)?chess-results\.com$/i.test(url.hostname)) url.protocol = "https:";
    return isChessResultsUrl(url) ? url.href : home;
  } catch {
    return home;
  }
}

export function isChessResultsUrl(target: URL): boolean {
  return target.protocol === "https:" &&
    !target.username && !target.password && !target.port &&
    /^(?:www\.|s\d+\.)?chess-results\.com$/i.test(target.hostname);
}
