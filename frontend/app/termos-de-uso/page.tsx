import { getLegalT } from "@/lib/i18n/legalPage";

export async function generateMetadata() {
  const { t } = await getLegalT();
  return { title: t("terms.metaTitle"), description: t("terms.metaDescription") };
}

const P = "text-sm leading-relaxed text-muted-foreground";
const UL = "list-disc space-y-2 pl-5 text-sm text-muted-foreground";
const A = "font-medium text-primary underline";
const H2 = "text-xl font-semibold";

function Mail({ address }: { address: string }) {
  return (
    <a className={A} href={`mailto:${address}`}>
      {address}
    </a>
  );
}

export default async function TermsOfUsePage() {
  const { t, r } = await getLegalT();
  const k = (key: string) => `terms.${key}`;
  // Parágrafo simples de uma chave (com negrito); a maior parte das cláusulas é assim.
  const Clause = ({ id }: { id: string }) => <p className={P}>{r(k(id))}</p>;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-3xl space-y-10">
          <header className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t(k("eyebrow"))}</p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">{t(k("title"))}</h1>
            <p className="text-sm text-muted-foreground">{r("updated")}</p>
            <p className="text-base leading-relaxed text-muted-foreground">{r(k("intro1"))}</p>
            <p className="text-base leading-relaxed text-muted-foreground">{t(k("intro2"))}</p>
          </header>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s1Title"))}</h2>
            <p className={P}>{t(k("s1Lead"))}</p>
            <ul className={UL}>
              {["s1Account", "s1User", "s1Meta", "s1AdAccount", "s1Entities", "s1Conversion", "s1Pack", "s1Plans", "s1Trial"].map((id) => (
                <li key={id}>{r(k(id))}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s2Title"))}</h2>
            <Clause id="s21" />
            <Clause id="s22" />
            <Clause id="s23" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s3Title"))}</h2>
            <Clause id="s31" />
            <Clause id="s32" />
            <Clause id="s33" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s4Title"))}</h2>
            <Clause id="s41" />
            <Clause id="s42" />
            <Clause id="s43" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s5Title"))}</h2>
            <Clause id="s51" />
            <Clause id="s52" />
            <Clause id="s53" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s6Title"))}</h2>
            <Clause id="s61" />
            <Clause id="s62" />
            <Clause id="s63" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s7Title"))}</h2>
            <Clause id="s71" />
            <Clause id="s72" />
            <Clause id="s73" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s8Title"))}</h2>
            <Clause id="s81" />
            <Clause id="s82" />
            <Clause id="s83" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s9Title"))}</h2>
            <p className={P}>{t(k("s9Lead"))}</p>
            <ul className={UL}>
              {["s9Illegal", "s9Bypass", "s9Exploit", "s9Copy", "s9Personal"].map((id) => (
                <li key={id}>{t(k(id))}</li>
              ))}
            </ul>
            <p className={P}>{t(k("s9Limits"))}</p>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s10Title"))}</h2>
            <Clause id="s101" />
            <Clause id="s102" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s11Title"))}</h2>
            <p className={P}>
              {r(k("s111"))}{" "}
              <a className={A} href="/politica-de-privacidade">
                https://hookifyads.com/politica-de-privacidade
              </a>
            </p>
            <p className={P}>
              {t(k("s112"))}{" "}
              <a className={A} href="https://hookifyads.com/exclusao-de-dados" target="_blank" rel="noopener noreferrer">
                https://hookifyads.com/exclusao-de-dados
              </a>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s12Title"))}</h2>
            <Clause id="s121" />
            <Clause id="s122" />
            <Clause id="s123" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s13Title"))}</h2>
            <Clause id="s131" />
            <Clause id="s132" />
            <Clause id="s133" />
            <Clause id="s134" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s14Title"))}</h2>
            <p className={P}>{t(k("s14Lead"))}</p>
            <ul className={UL}>
              {["s14Misuse", "s14Breach", "s14Rights", "s14Actions"].map((id) => (
                <li key={id}>{t(k(id))}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s15Title"))}</h2>
            <p className={P}>{t(k("s15Channels"))}</p>
            <p className={P}>
              {t(k("s15Email"))} <Mail address="milazzo@hookifyads.com" />, <Mail address="support@hookifyads.com" />,{" "}
              <Mail address="legal@hookifyads.com" />
            </p>
            <p className={P}>{t(k("s15Whatsapp"))}</p>
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s16Title"))}</h2>
            <Clause id="s161" />
            <Clause id="s162" />
            <Clause id="s163" />
          </section>

          <section className="space-y-4">
            <h2 className={H2}>{t(k("s17Title"))}</h2>
            <Clause id="s171" />
            <Clause id="s172" />
          </section>
        </div>
      </main>
    </div>
  );
}
