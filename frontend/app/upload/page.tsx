"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { PageContainer } from "@/components/common/PageContainer"
import { LaunchWizard } from "@/components/launch/LaunchWizard"

// Duplicação de campanha com criativos novos — documentation/plano-duplicacao-de-campanha.md
function UploadPageContent() {
  // `?ad=<id>`: atalho "Usar como modelo" do Manager já chega com o modelo escolhido.
  const initialAdId = useSearchParams().get("ad")
  return <LaunchWizard initialAdId={initialAdId} />
}

export default function UploadPage() {
  return (
    <PageContainer
      variant="standard"
      title="Lançar criativos"
      description="Duplique uma campanha que já roda trocando só a mídia — do computador ou de uma pasta do Google Drive"
    >
      <Suspense fallback={null}>
        <UploadPageContent />
      </Suspense>
    </PageContainer>
  )
}
