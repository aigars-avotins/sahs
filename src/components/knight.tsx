type KnightTone = "white" | "black" | "green";

const FILL: Record<KnightTone, string> = {
  white: "#fffaf2",
  black: "#1c1612",
  green: "#0e6a3e",
};

const EYE: Record<KnightTone, string> = {
  white: "#1c1612",
  black: "#f6e2b0",
  green: "#f6e2b0",
};

const KNIGHT =
  "12,58 52,58 50,50 36,49 38,40 58,43 62,32 46,26 44,18 40,6 30,16 26,14 18,26 16,38 18,50";

export function Knight({
  tone = "green",
  className,
}: {
  tone?: KnightTone;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <polygon points="10,56 54,56 54,62 10,62" fill={FILL[tone]} stroke={tone === "black" ? "#f6e2b0" : "#1c1612"} strokeWidth="1.2" />
      <polygon points={KNIGHT} fill={FILL[tone]} stroke={tone === "black" ? "#f6e2b0" : "#1c1612"} strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="44" cy="24" r="2.2" fill={EYE[tone]} />
    </svg>
  );
}
