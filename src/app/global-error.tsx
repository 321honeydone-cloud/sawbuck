"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0c",
          color: "#f4f3ee",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
            Something went wrong
          </div>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              background: "#c9a227",
              color: "#000",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
