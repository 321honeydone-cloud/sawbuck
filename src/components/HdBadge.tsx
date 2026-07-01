// Sawbuck app badge: the hex mark on a charcoal tile. Drop-in via the size prop.
export default function HdBadge({ size = 38 }: { size?: number }) {
  const radius = Math.round(size * 0.24);
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "#14181f",
        border: "1px solid rgba(254,216,17,0.18)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <svg viewBox="0 0 120 120" width={size * 0.62} height={size * 0.62}>
        <path
          d="M60 13 L100.7 36.5 L100.7 83.5 L60 107 L19.3 83.5 L19.3 36.5 Z"
          fill="none"
          stroke="#FED811"
          strokeWidth="9"
          strokeLinejoin="round"
        />
        <path
          d="M60 30 Q66.5 53.5 90 60 Q66.5 66.5 60 90 Q53.5 66.5 30 60 Q53.5 53.5 60 30 Z"
          fill="#FED811"
        />
      </svg>
    </div>
  );
}
