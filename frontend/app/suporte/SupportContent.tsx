"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { IconBrandWhatsappFilled, IconMail } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

const WHATSAPP_URL =
  "https://api.whatsapp.com/send/?phone=5532998092905&text=Preciso+de+suporte+no+Hookify";
const EMAIL_PRIMARY = "milazzo@hookifyads.com";
const EMAIL_SECONDARY = "gethookify@gmail.com";

export function SupportContent() {
  const t = useTranslations("support");
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-2xl space-y-10">
          <header className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("eyebrow")}
            </p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
              {t("title")}
            </h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              {t("intro")}
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">WhatsApp</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("whatsappIntro")}
            </p>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                <IconBrandWhatsappFilled className="size-5" />
                {t("whatsappButton")}
              </a>
            </Button>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">{t("emailTitle")}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("emailIntro")}
            </p>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <a href={`mailto:${EMAIL_PRIMARY}`}>
                <IconMail className="size-5" />
                {EMAIL_PRIMARY}
              </a>
            </Button>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("secondary")}{" "}
              <a
                className="font-medium text-primary underline"
                href={`mailto:${EMAIL_SECONDARY}`}
              >
                {EMAIL_SECONDARY}
              </a>
            </p>
          </section>

          <footer className="pt-2">
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground underline hover:text-foreground"
            >
              {t("back")}
            </Link>
          </footer>
        </div>
      </main>
    </div>
  );
}
