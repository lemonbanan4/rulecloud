import { ImageResponse } from "next/og";

export const alt = "RuleCloud — Architectural Guardrails";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "linear-gradient(145deg, #09090B 0%, #18181B 55%, #0c1222 100%)",
          color: "#FAFAFA",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#18181B",
              border: "1px solid rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
            }}
          >
            🛡️
          </div>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>
            RuleCloud
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 48,
              fontWeight: 700,
              lineHeight: 1.15,
              maxWidth: 900,
            }}
          >
            Architectural Guardrails for AI-Speed Engineering
          </div>
          <div style={{ display: "flex", marginTop: 16, fontSize: 22, color: "#A1A1AA" }}>
            PR scans · inline suggestions · guardrail.yaml
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "12px 20px",
              borderRadius: 10,
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.4)",
              color: "#FCA5A5",
            }}
          >
            3 violations
          </div>
          <div style={{ display: "flex", color: "#71717A" }}>checkout.ts:8</div>
          <div style={{ display: "flex", color: "#34D399" }}>rulecloud.vercel.app</div>
        </div>
      </div>
    ),
    { ...size },
  );
}