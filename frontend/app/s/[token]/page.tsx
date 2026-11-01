import { cache } from "react";
import { headers } from "next/headers";
import { pickLocale, type AppLocale } from "@/lib/i18n/config";
import { translateIn } from "@/lib/i18n/translate";
import type { Metadata } from "next";
import { fetchPublicShare } from "@/lib/share/publicApi";
import { StoriesViewer } from "@/components/share/StoriesViewer";
import { ShareUnavailable } from "@/components/share/ShareUnavailable";
import { ShareLocale } from "@/components/share/ShareLocale";

// Snapshot é imutável, mas expiração/revogação precisam valer imediatamente —
// sempre dinâmico, sem cache de rota.
export const dynamic = "force-dynamic";

// Dedupe do fetch entre generateMetadata e a página (mesma request).
const getShare = cache(fetchPublicShare);

function formatDate(iso: string, locale: AppLocale): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale);
}

// Prévia do link (WhatsApp etc.) no idioma que o navegador de quem pede declara; sem declarar, o padrão.
async function requestLocale(): Promise<AppLocale> {
  const header = (await headers()).get("accept-language") ?? "";
  return pickLocale(header.split(",").map((part) => part.split(";")[0].trim()).filter(Boolean));
}

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await getShare(token);
  const locale = await requestLocale();

  // Link morto também não deve ser indexado nem desdobrar bonito
  if (!share) {
    return { title: translateIn(locale, "share.meta.expired"), robots: { index: false, follow: false } };
  }

  const title = translateIn(locale, "share.meta.title", { count: share.items.length });
  const description = translateIn(locale, "share.meta.description", {
    start: formatDate(share.date_start, locale),
    end: formatDate(share.date_stop, locale),
  });
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

  return (
    <ShareLocale>
      {!share || share.items.length === 0 ? <ShareUnavailable /> : <StoriesViewer share={share} />}
    </ShareLocale>
  );
}
