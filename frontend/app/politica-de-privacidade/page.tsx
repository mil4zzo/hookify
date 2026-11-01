import { getLegalT } from "@/lib/i18n/legalPage";

export async function generateMetadata() {
  const { t } = await getLegalT();
  return { title: t("privacy.metaTitle"), description: t("privacy.metaDescription") };
}

const P = "text-sm leading-relaxed text-muted-foreground";
const UL = "list-disc space-y-2 pl-5 text-sm text-muted-foreground";
const OL = "list-decimal space-y-2 pl-5 text-sm text-muted-foreground";
const A = "font-medium text-primary underline";
const H2 = "text-xl font-semibold";
const H3 = "text-lg font-medium";

function Mail({ address }: { address: string }) {
  return (
    <a className={A} href={`mailto:${address}`}>
      {address}
    </a>
  );
}

export default async function PrivacyPolicyPage() {
  const { t, r } = await getLegalT();
  const k = (key: string) => `privacy.${key}`;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-3xl space-y-10">
          <header className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t(k("eyebrow"))}</p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">{t(k("title"))}</h1>
            <p className="text-sm text-muted-foreground">{r("updated")}</p>
            <p className="text-base leading-relaxed text-muted-foreground">{r(k("intro"))}</p>
          </header>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s1Title"))}</h2>
            <p className={P}>{t(k("s1Operator"))}</p>
            <p className={P}>{t(k("s1Address"))}</p>
            <p className={P}>
              {t(k("s1Contact"))} <Mail address="milazzo@hookifyads.com" />
            </p>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s2Title"))}</h2>

            <h3 className={H3}>{t(k("s21Title"))}</h3>
            <p className={P}>{t(k("s21Lead"))}</p>
            <ul className={UL}>
              <li>{r(k("s21Name"))}</li>
              <li>{r(k("s21Email"))}</li>
              <li>{r(k("s21Photo"))}</li>
            </ul>

            <h3 className={H3}>{t(k("s22Title"))}</h3>
            <p className={P}>{r(k("s22Lead"))}</p>
            <ul className={UL}>
              <li>{r(k("s22Assets"))}</li>
              <li>{r(k("s22Metrics"))}</li>
              <li>{r(k("s22Creatives"))}</li>
            </ul>
            <blockquote className="border-l-2 border-border pl-4 text-sm italic text-muted-foreground">
              {r(k("s22Quote"))}
            </blockquote>

            <h3 className={H3}>{t(k("s23Title"))}</h3>
            <p className={P}>{r(k("s23Body"))}</p>

            <h3 className={H3}>{t(k("s24Title"))}</h3>
            <p className={P}>{t(k("s24Lead"))}</p>
            <ul className={UL}>
              <li>{t(k("s24Item"))}</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s3Title"))}</h2>
            <p className={P}>{t(k("s3Lead"))}</p>
            <ol className={OL}>
              <li>{r(k("s3Operate"))}</li>
              <li>{r(k("s3Account"))}</li>
              <li>{r(k("s3Support"))}</li>
              <li>{r(k("s3Security"))}</li>
              <li>{r(k("s3Benchmarks"))}</li>
            </ol>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s4Title"))}</h2>
            <p className={P}>{r(k("s4NoSale"))}</p>
            <p className={P}>{t(k("s4Lead"))}</p>
            <ul className={UL}>
              <li>{r(k("s4Providers"))}</li>
              <li>{r(k("s4Legal"))}</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s5Title"))}</h2>
            <ul className={UL}>
              <li>{r(k("s5Cache"))}</li>
              <li>{t(k("s5Keep"))}</li>
              <li>{t(k("s5Deletion"))}</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s6Title"))}</h2>
            <p className={P}>{t(k("s6Lead"))}</p>
            <ul className={UL}>
              <li>{r(k("s6Tokens"))}</li>
              <li>{r(k("s6Isolation"))}</li>
              <li>{r(k("s6Https"))}</li>
              <li>{t(k("s6Monitoring"))}</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s7Title"))}</h2>
            <p className={P}>{t(k("s7Body"))}</p>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s8Title"))}</h2>
            <p className={P}>{t(k("s8Lead"))}</p>
            <p className="text-sm font-medium text-foreground">{t(k("s8HowTitle"))}</p>
            <ol className={OL}>
              <li>
                {r(k("s8Email"))} <Mail address="legal@hookifyads.com" /> {r(k("s8EmailSubject"))}
              </li>
              <li>{r(k("s8Facebook"))}</li>
              <li>{r(k("s8Google"))}</li>
            </ol>
            <p className="text-sm font-medium text-foreground">{t(k("s8WhatTitle"))}</p>
            <ul className={UL}>
              <li>{t(k("s8Delete"))}</li>
              <li>{t(k("s8Keep"))}</li>
              <li>
                {t(k("s8Instructions"))}{" "}
                <a className={A} href="https://hookifyads.com/exclusao-de-dados" target="_blank" rel="noopener noreferrer">
                  https://hookifyads.com/exclusao-de-dados
                </a>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s9Title"))}</h2>
            <p className={P}>{t(k("s9Body"))}</p>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s10Title"))}</h2>
            <p className={P}>
              {t(k("s10Email"))} <Mail address="milazzo@hookifyads.com" />, <Mail address="support@hookifyads.com" />,{" "}
              <Mail address="legal@hookifyads.com" />
            </p>
            <p className={P}>{t(k("s10Whatsapp"))}</p>
          </section>
        </div>
      </main>
    </div>
  );
}
