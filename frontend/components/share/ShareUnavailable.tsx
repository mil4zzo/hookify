import Image from "next/image";
import { Button } from "@/components/ui/button";
import { getSiteOrigin } from "@/lib/utils/siteUrl";

/**
 * Estado terminal do link compartilhado: inexistente, revogado ou expirado.
 * 404 genérico por design (o backend não distingue) — o tom leve transforma a
 * expiração em CTA: métricas congeladas envelhecem, peça um link novo.
 */
export function ShareUnavailable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-text">
      <div className="w-full max-w-sm space-y-6 text-center">
        <Image src="/logo-hookify-alpha.png" alt="Hookify" width={80} height={21} className="mx-auto h-[21px] w-[80px]" priority />
        <div className="space-y-2">
          <p className="text-4xl" aria-hidden>
            😴
          </p>
          <h1 className="text-xl font-semibold leading-tight">Esse link tirou uma soneca — e não voltou</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Links compartilhados expiram de propósito: métricas congeladas envelhecem mal. Peça um link
            novinho para quem te enviou ;)
          </p>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <a href={`${getSiteOrigin()}/pv`}>Conhecer o Hookify</a>
        </Button>
      </div>
    </div>
  );
}
