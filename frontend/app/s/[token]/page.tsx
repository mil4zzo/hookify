import { cache } from "react";
import type { Metadata } from "next";
import { fetchPublicShare } from "@/lib/share/publicApi";
import { StoriesViewer } from "@/components/share/StoriesViewer";
import { ShareUnavailable } from "@/components/share/ShareUnavailable";

// Snapshot é imutável, mas expiração/revogação precisam valer imediatamente —
// sempre dinâmico, sem cache de rota.
export const dynamic = "force-dynamic";

// Dedupe do fetch entre generateMetadata e a página (mesma request).
const getShare = cache(fetchPublicShare);

function formatDatePt(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await getShare(token);

  // Link morto também não deve ser indexado nem desdobrar bonito
  if (!share) {
    return { title: "Link expirado · Hookify", robots: { index: false, follow: false } };
  }

  const count = share.items.length;
  const title = `${count} criativo${count !== 1 ? "s" : ""} · Hookify`;
  const description = `Métricas de ${formatDatePt(share.date_start)} a ${formatDatePt(share.date_stop)} — compartilhado com Hookify.`;
  const thumbnail = share.items.find((item) => item.media.thumbnail_url)?.media.thumbnail_url;

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "website",
      ...(thumbnail ? { images: [{ url: thumbnail }] } : {}),
    },
    twitter: {
      card: thumbnail ? "summary_large_image" : "summary",
      title,
      description,
      ...(thumbnail ? { images: [thumbnail] } : {}),
    },
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;
  const share = await getShare(token);

  if (!share || share.items.length === 0) {
    return <ShareUnavailable />;
  }

  return <StoriesViewer share={share} />;
}
