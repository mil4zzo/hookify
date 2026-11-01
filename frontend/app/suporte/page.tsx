import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { translateIn } from "@/lib/i18n/translate";
import { SupportContent } from "./SupportContent";

export async function generateMetadata() {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { title: translateIn(locale, "support.meta.title"), description: translateIn(locale, "support.meta.description") };
}

export default function SupportPage() {
  return <SupportContent />;
}
