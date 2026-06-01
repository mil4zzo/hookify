import type { Metadata } from "next";
import { getSiteOrigin } from "@/lib/utils/siteUrl";
import { WaitlistV2 } from "@/components/waitlist/WaitlistV2";

export const metadata: Metadata = {
  metadataBase: getSiteOrigin(),
  title: "Hookify — entre na lista de acesso antecipado",
  description:
    "Seja um dos primeiros a analisar anúncios da Meta sem achismo. Vagas limitadas no early access do Hookify. Entre na waitlist.",
  alternates: { canonical: "/waitlist-v2" },
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    url: "/waitlist-v2",
    title: "Hookify — acesso antecipado (waitlist)",
    description:
      "Garanta seu lugar na fila. Os primeiros da lista recebem acesso antecipado ao Hookify.",
  },
};

export default function WaitlistV2Page() {
  return <WaitlistV2 source="waitlist-v2-hero" />;
}
