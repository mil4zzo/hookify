"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "32px",
          fontFamily: "system-ui, sans-serif",
          backgroundColor: "#0a0a0a",
          color: "#fafafa",
        }}>
          <h2 style={{ fontSize: "20px", fontWeight: 600 }}>Algo deu errado</h2>
          <p style={{ fontSize: "14px", color: "#a1a1aa" }}>
            Ocorreu um erro inesperado. Tente novamente.
          </p>
          <button
            onClick={reset}
            style={{
              borderRadius: "8px",
              backgroundColor: "#7c3aed",
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: 500,
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  )
}
