import { getLegalT } from "@/lib/i18n/legalPage";

export async function generateMetadata() {
  const { t } = await getLegalT();
  return { title: t("deletion.metaTitle"), description: t("deletion.metaDescription") };
}

const P = "text-sm leading-relaxed text-muted-foreground";
const UL = "list-disc space-y-2 pl-5 text-sm text-muted-foreground";
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

export default async function DataDeletionPage() {
  const { t, r } = await getLegalT();
  const k = (key: string) => `deletion.${key}`;
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

          <section className="space-y-6">
            <h2 className={H2}>{t(k("s1Title"))}</h2>
            <p className={P}>{t(k("s1Lead"))}</p>

            <div className="space-y-3">
              <h3 className={H3}>{t(k("optATitle"))}</h3>
              <p className={P}>
                {t(k("optASend"))} <Mail address="legal@hookifyads.com" /> {t(k("optAWith"))}
              </p>
              <ul className={UL}>
                <li>
                  {r(k("optASubjectLabel"))}{" "}
                  <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs">{t(k("optASubject"))}</code>
                </li>
                <li>{r(k("optABodyLabel"))}</li>
              </ul>
              <blockquote className="border-l-2 border-border pl-4 text-sm italic text-muted-foreground">
                {t(k("optAQuote"))}
              </blockquote>
            </div>

            <div className="space-y-3">
              <h3 className={H3}>{t(k("optBTitle"))}</h3>
              <p className={P}>{t(k("optBLead"))}</p>
              <ul className={UL}>
                <li>{r(k("optBStep1"))}</li>
                <li>{r(k("optBStep2"))}</li>
                <li>{r(k("optBStep3"))}</li>
              </ul>
              <p className={P}>{r(k("optBNote"))}</p>
            </div>

            <div className="space-y-3">
              <h3 className={H3}>{t(k("optCTitle"))}</h3>
              <p className={P}>{t(k("optCLead"))}</p>
              <ul className={UL}>
                <li>{r(k("optCStep1"))}</li>
                <li>{t(k("optCStep2"))}</li>
              </ul>
              <p className={P}>{r(k("optCNote"))}</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s2Title"))}</h2>
            <p className={P}>{t(k("s2Lead"))}</p>
            <ul className={UL}>
              <li>{r(k("s2Profile"))}</li>
              <li>{r(k("s2Tokens"))}</li>
              <li>{r(k("s2Imported"))}</li>
              <li>{t(k("s2Settings"))}</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s3Title"))}</h2>
            <p className={P}>{t(k("s3Lead"))}</p>
            <ul className={UL}>
              <li>{t(k("s3Start"))}</li>
              <li>{t(k("s3Confirm"))}</li>
            </ul>
            <blockquote className="border-l-2 border-border pl-4 text-sm italic text-muted-foreground">
              {t(k("s3Quote"))}
            </blockquote>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s4Title"))}</h2>
            <p className={P}>{t(k("s4Lead"))}</p>
            <p className={P}>
              {r(k("s4Email"))} <Mail address="support@hookifyads.com" /> {t(k("s4Or"))}{" "}
              <Mail address="milazzo@hookifyads.com" />
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
