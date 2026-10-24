/** Chess-results load-balances requests onto its numbered S-node hosts. */
export function isChessResultsUrl(target: URL): boolean {
  return target.protocol === "https:" &&
    !target.username && !target.password && !target.port &&
    /^(?:www\.|s\d+\.)?chess-results\.com$/i.test(target.hostname);
}
