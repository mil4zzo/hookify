import { ImageResponse } from "next/og";
import { getSiteUrl } from "@/lib/utils/siteUrl";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const siteUrl = getSiteUrl();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(135deg, #0b0b10 0%, #10102a 55%, #0b0b10 100%)",
          color: "white",
          padding: 64,
          justifyContent: "space-between",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              fontSize: 18,
              letterSpacing: 3,
              textTransform: "uppercase",
              opacity: 0.9,
            }}
          >
            Hookify
            <span style={{ opacity: 0.7 }}>•</span>
            Meta Ads
          </div>
          <div style={{ fontSize: 64, lineHeight: 1.05, fontWeight: 700 }}>
            Análise de anúncios
            <br />
            sem achismo.
          </div>
          <div style={{ fontSize: 26, lineHeight: 1.3, opacity: 0.9, maxWidth: 980 }}>
            Packs, rankings e insights para enxergar o que escalar — e o que cortar.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 18,
            opacity: 0.85,
          }}
        >
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span style={{ padding: "8px 12px", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999 }}>
              Packs
            </span>
            <span style={{ padding: "8px 12px", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999 }}>
              Rankings
            </span>
            <span style={{ padding: "8px 12px", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999 }}>
              Google Sheets
            </span>
          </div>
          <div>{siteUrl.replace(/^https?:\/\//, "")}</div>
        </div>
      </div>
    ),
    { ...size }
  );
}

