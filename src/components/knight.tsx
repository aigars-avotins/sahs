export function Knight({
  tone = "white",
  className,
}: {
  tone?: "white" | "black";
  className?: string;
}) {
  return (
    <img
      src={tone === "black" ? "/pieces/bN.svg" : "/pieces/wN.svg"}
      alt=""
      className={className}
    />
  );
}
