import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { IconBolt, IconCrown, IconRoute, IconArrowUpRight } from "@tabler/icons-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { getSiteOrigin, getSiteUrl } from "@/lib/utils/siteUrl";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";

const SITE_URL = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: getSiteOrigin(),
  title: "Hookify — pare de adivinhar qual criativo escalar",
  description:
    "Escala no feeling e vê o CPA subir sem saber qual criativo segurou o resultado? O Hookify junta seus anúncios da Meta num placar — Hook, CTR, CPR e Leadscore — pra escalar o que funciona. Entre no acesso antecipado.",
  alternates: { canonical: "/waitlist" },
  openGraph: {
    type: "website",
    url: "/waitlist",
    title: "Hookify — pare de adivinhar qual criativo escalar",
    description:
      "Leia seus anúncios da Meta como um placar e decida o que escalar sem achismo. Quem entra cedo garante a condição de fundador. Entre no acesso antecipado.",
    images: [
      {
        url: "/waitlist/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Hookify — acesso antecipado",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hookify — pare de adivinhar qual criativo escalar",
    description:
      "Leia seus anúncios da Meta como um placar e escale sem achismo. Condição de fundador para quem entra cedo.",
    images: ["/waitlist/opengraph-image"],
  },
};

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Deixe seu e-mail",
    desc: "Leva 10 segundos. Quem entra cedo garante a condição de fundador — desconto e benefícios fora da tabela pública.",
  },
  {
    step: "02",
    title: "Receba seu acesso",
    desc: "Estamos liberando o acesso aos poucos para quem se cadastra. Pode não ser na hora, mas você entra na frente da fila e é avisado por e-mail.",
  },
  {
    step: "03",
    title: "Rode seu 1º Pack",
    desc: "Conecte a Meta, importe seus anúncios e veja, lado a lado, qual criativo escalar e qual está drenando orçamento.",
  },
];

const PERKS = [
  {
    Icon: IconBolt,
    title: "Decida com dado, não com feeling",
    desc: "Pare de escalar no achismo. Veja qual criativo segura o resultado antes de queimar orçamento testando no escuro.",
  },
  {
    Icon: IconCrown,
    title: "Condição de fundador",
    desc: "Quem entra cedo trava desconto e benefícios de fundador, fora da tabela pública. Pode encerrar a qualquer momento.",
  },
  {
    Icon: IconRoute,
    title: "Voz no roadmap",
    desc: "Os primeiros usuários moldam o produto. Seu feedback vira prioridade, não ticket esquecido.",
  },
];

const SCOREBOARD = [
  { rank: "01", name: "HOOK_07", tag: "UGC", hook: "0.38", ctr: "2.1%", cpr: "R$ 12", top: true },
  { rank: "02", name: "HOOK_03", tag: "Oferta", hook: "0.31", ctr: "1.7%", cpr: "R$ 15" },
  { rank: "03", name: "HOOK_02", tag: "Depoimento", hook: "0.24", ctr: "1.2%", cpr: "R$ 19", dim: true },
];

const FAQS = [
  {
    q: "O que é o Hookify?",
    a: "Uma ferramenta para ler seus anúncios da Meta como um placar. Você importa campanhas em Packs e compara performance pelas métricas que importam — Hook, CTR, CPR, CPMQL e Leadscore — pra saber o que escalar e o que cortar.",
  },
  {
    q: "Já uso o Gerenciador de Anúncios. Por que preciso disso?",
    a: "O Gerenciador mostra número solto, conta por conta. O Hookify coloca seus criativos lado a lado num ranking e cruza com Leadscore (qualidade do lead) — então você compara hook contra hook e decide em segundos, sem montar planilha.",
  },
  {
    q: "Entrar na lista tem custo?",
    a: "Não. Entrar é grátis. Quem entra cedo trava a condição de fundador — desconto e benefícios — quando ativar a conta.",
  },
  {
    q: "Quando recebo o acesso?",
    a: "Estamos liberando o acesso aos poucos para quem se cadastra. Pode não ser imediato, mas você entra na frente da fila e é avisado por e-mail assim que sua vez chegar.",
  },
  {
    q: "Para quem é o Hookify?",
    a: "Para quem roda Meta Ads e precisa decidir com clareza: gestores de tráfego, performance e times de criativo que cansaram de escalar no feeling e caçar número em planilha.",
  },
];

// Kicker monoespaçado com régua — assinatura visual "terminal" repetida em cada seção.
function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-3 font-mono text-xs uppercase tracking-[0.28em] text-muted-foreground">
      <span className="h-px w-8 bg-primary" aria-hidden="true" />
      {children}
    </p>
  );
}

export default function WaitlistPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Hookify",
    url: SITE_URL,
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "support@hookifyads.com",
      },
    ],
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify([orgSchema, faqSchema]) }}
      />

      {/* HERO */}
      <section className="relative overflow-hidden">
        {/* Texturas de fundo: grade de engenharia + dois glows (primário dominante, attention de apoio) */}
        <div className="lp-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-primary-20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -top-24 right-[8%] h-[280px] w-[280px] rounded-full bg-attention-20 blur-3xl"
          aria-hidden="true"
        />

        <main className="container relative mx-auto px-4 md:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl py-20 text-center md:py-28">
            <Image
              src="/logo-hookify-alpha.png"
              alt="Hookify"
              width={150}
              height={40}
              priority
              className="lp-rise lp-d1 mx-auto mb-8 h-[40px] w-[150px]"
            />

            <div className="lp-rise lp-d2 mb-6 inline-flex items-center gap-2 rounded-full border border-primary-30 bg-primary-10 px-4 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-primary">
              <span className="lp-blink h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              Acesso antecipado · condição de fundador
            </div>

            <h1 className="lp-rise lp-d3 text-balance text-4xl font-semibold leading-[1.03] tracking-tight md:text-6xl">
              Pare de{" "}
              <span className="text-muted-foreground line-through decoration-attention decoration-2">
                adivinhar
              </span>{" "}
              qual criativo escalar.
              <span className="mt-2 block bg-gradient-to-r from-primary via-primary to-attention bg-clip-text text-transparent">
                Leia seus anúncios como um placar.
              </span>
            </h1>

            <p className="lp-rise lp-d4 mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Toda semana você escala no feeling, vê o CPA subir e não sabe qual criativo segurou o
              resultado. O Hookify junta seus anúncios da Meta num placar — Hook, CTR, CPR e Leadscore
              lado a lado — pra você escalar o que funciona e cortar o que drena orçamento.
            </p>

            <div className="lp-rise lp-d5 mx-auto mt-9 max-w-xl">
              <WaitlistForm source="waitlist-hero" />
            </div>

            <div className="lp-rise lp-d6 mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                Análise de criativos
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                Rankings por métrica
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-attention" aria-hidden="true" />
                Leadscore
              </span>
            </div>

            <p className="lp-rise lp-d6 mx-auto mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Criado por quem já analisou dados de{" "}
              <span className="font-medium text-text">+R$ 15 milhões</span> investidos em Meta Ads na
              última década.
            </p>
          </div>

          {/* ÂNCORA: terminal com placar ao vivo, sobrepondo o fim do hero */}
          <div className="lp-rise lp-d6 relative z-10 mx-auto -mb-16 max-w-3xl translate-y-8 md:-mb-24">
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-elevation-overlay">
              {/* Chrome de janela */}
              <div className="flex items-center gap-3 border-b border-border bg-background-40 px-4 py-2.5">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
                  <span className="h-2.5 w-2.5 rounded-full bg-attention" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success" />
                </div>
                <span className="font-mono text-xs text-muted-foreground">hookify · rankings</span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-success-30 bg-success-10 px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.16em] text-success">
                  <span className="lp-blink h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                  Live
                </span>
              </div>

              {/* Placar */}
              <div className="p-4 md:p-5">
                <div className="grid grid-cols-[auto_1fr_repeat(3,auto)] items-center gap-x-3 gap-y-1 md:gap-x-5">
                  <div className="font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">#</div>
                  <div className="font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">Criativo</div>
                  <div className="text-right font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">Hook</div>
                  <div className="text-right font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">CTR</div>
                  <div className="text-right font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">CPR</div>
                  <div className="col-span-5 my-1 h-px bg-border" />

                  {SCOREBOARD.map((row, i) => (
                    <div
                      key={row.name}
                      className={`lp-row col-span-5 grid grid-cols-[auto_1fr_repeat(3,auto)] items-center gap-x-3 rounded-md px-2 py-2 md:gap-x-5 ${
                        row.top ? "border border-primary-30 bg-primary-10" : ""
                      }`}
                      style={{ animationDelay: `${0.5 + i * 0.12}s` }}
                    >
                      <div className={`font-mono text-xs ${row.top ? "text-primary" : "text-muted-foreground"}`}>
                        {row.rank}
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`truncate font-mono text-sm ${row.dim ? "text-muted-foreground" : "text-text"}`}>
                          {row.name}
                        </span>
                        <span className="hidden shrink-0 rounded-sm bg-surface-fill px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wide text-muted-foreground sm:inline">
                          {row.tag}
                        </span>
                        {row.top && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-primary-foreground">
                            <IconArrowUpRight size={11} stroke={2.5} aria-hidden="true" />
                            Top
                          </span>
                        )}
                      </div>
                      <div className={`text-right font-mono text-sm tabular-nums ${row.top ? "font-semibold text-primary" : row.dim ? "text-muted-foreground" : "text-text"}`}>
                        {row.hook}
                      </div>
                      <div className={`text-right font-mono text-sm tabular-nums ${row.dim ? "text-muted-foreground" : "text-text"}`}>
                        {row.ctr}
                      </div>
                      <div className={`text-right font-mono text-sm tabular-nums ${row.dim ? "text-muted-foreground" : "text-text"}`}>
                        {row.cpr}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </section>

      <div className="container relative mx-auto px-4 md:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-24 pb-24 pt-28 md:space-y-28 md:pt-36">
          {/* COMO FUNCIONA */}
          <section className="space-y-10">
            <header className="mx-auto max-w-2xl space-y-4 text-center">
              <div className="flex justify-center">
                <SectionKicker>Do convite ao primeiro insight</SectionKicker>
              </div>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Como funciona o acesso antecipado
              </h2>
            </header>

            <div className="grid gap-4 md:grid-cols-3">
              {HOW_IT_WORKS.map((item) => (
                <div
                  key={item.step}
                  className="group relative overflow-hidden rounded-lg border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary-30"
                >
                  {/* Numeral mono gigante em watermark */}
                  <span className="pointer-events-none absolute -right-2 -top-5 select-none font-mono text-7xl font-bold text-primary-10 transition-colors duration-300 group-hover:text-primary-20">
                    {item.step}
                  </span>
                  <div className="relative space-y-2">
                    <span className="font-mono text-sm text-primary">{item.step}</span>
                    <h3 className="text-lg font-semibold">{item.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* PERKS / POR QUE ENTRAR */}
          <section className="space-y-10">
            <header className="mx-auto max-w-2xl space-y-4 text-center">
              <div className="flex justify-center">
                <SectionKicker>Por que entrar agora</SectionKicker>
              </div>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Quem entra cedo larga na frente
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                Entrar na lista não é só furar fila — é travar condição e parar de queimar orçamento
                no escuro antes da concorrência.
              </p>
            </header>

            <div className="grid gap-4 md:grid-cols-3">
              {PERKS.map(({ Icon, title, desc }) => (
                <div
                  key={title}
                  className="group relative overflow-hidden rounded-lg border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary-30"
                >
                  {/* Barra de acento que cresce no hover */}
                  <span
                    className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-primary to-attention transition-transform duration-300 group-hover:scale-x-100"
                    aria-hidden="true"
                  />
                  <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-md border border-primary-30 bg-primary-10 text-primary">
                    <Icon size={22} stroke={1.75} aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* PREVIEW DO PRODUTO */}
          <section className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-5">
              <SectionKicker>Antes e depois</SectionKicker>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Saia da planilha. Entre no placar.
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                Antes: aba do Gerenciador aberta, números soltos, decisão no escuro. Depois: seus
                criativos rankeados num lugar só. Em segundos você sabe o que{" "}
                <span className="font-medium text-text">escalar</span>, o que{" "}
                <span className="font-medium text-text">cortar</span> e{" "}
                <span className="font-medium text-text">por quê</span> — por Hook, CTR, CPR e Leadscore.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {["Meta Ads", "Packs", "Rankings", "Leadscore"].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-border bg-card px-3 py-1 font-mono text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            {/* Mini-painel de métricas com destaque para o "vencedor" */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
              <div className="rounded-lg border border-primary-30 bg-primary-10 p-4">
                <p className="font-mono text-2xs uppercase tracking-[0.16em] text-primary">Hook · campeão</p>
                <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-text">0.38</p>
                <p className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-success">
                  <IconArrowUpRight size={13} stroke={2.5} aria-hidden="true" />
                  +22% vs. média
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">CTR</p>
                <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-text">2.1%</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">link click</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">CPR</p>
                <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-text">R$ 12</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">custo / resultado</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">Leadscore</p>
                <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-text">8.4</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">via Google Sheets</p>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section className="space-y-10">
            <header className="mx-auto max-w-2xl space-y-4 text-center">
              <div className="flex justify-center">
                <SectionKicker>Perguntas rápidas</SectionKicker>
              </div>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Tudo que você precisa saber</h2>
            </header>
            <Accordion type="single" collapsible className="mx-auto grid max-w-3xl gap-3">
              {FAQS.map((faq) => (
                <AccordionItem
                  key={faq.q}
                  value={faq.q}
                  className="bg-card transition-colors duration-200 hover:border-primary-30"
                >
                  <AccordionTrigger className="text-left text-base">{faq.q}</AccordionTrigger>
                  <AccordionContent className="leading-relaxed text-muted-foreground">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          {/* CTA FINAL — borda em gradiente (primário → attention) */}
          <section className="rounded-lg bg-gradient-to-r from-primary to-attention p-px shadow-elevation-raised">
            <div className="relative overflow-hidden rounded-lg bg-card p-8 text-center md:p-12">
              <div className="lp-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
              <div className="relative mx-auto max-w-2xl space-y-5">
                <div className="flex justify-center">
                  <SectionKicker>Condição de fundador · enquanto estiver aberto</SectionKicker>
                </div>
                <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                  Trave sua condição de fundador antes que feche
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  O desconto e os benefícios de fundador podem encerrar a qualquer momento. Deixe seu
                  e-mail e entre na frente da fila — sem compromisso, sem spam.
                </p>
                <div className="mx-auto max-w-xl pt-2">
                  <WaitlistForm source="waitlist-cta" />
                </div>
              </div>
            </div>
          </section>

          {/* FOOTER */}
          <footer className="flex flex-col gap-2 border-t border-border pt-8 font-mono text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
            <p>
              © {new Date().getFullYear()} Hookify.{" "}
              <Link className="underline underline-offset-4" href="/politica-de-privacidade">
                Política de privacidade
              </Link>{" "}
              ·{" "}
              <Link className="underline underline-offset-4" href="/termos-de-uso">
                Termos de uso
              </Link>
            </p>
            <p>
              Já tem convite?{" "}
              <Link className="font-medium text-primary underline underline-offset-4" href="/login">
                Entrar
              </Link>
            </p>
          </footer>
        </div>
      </div>

      {/* Estilo escopado: texturas + sequência de entrada. Só transform/opacity; cores via tokens.
          Respeita prefers-reduced-motion. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
.lp-grid {
  background-image:
    linear-gradient(to right, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px);
  background-size: 54px 54px;
  -webkit-mask-image: radial-gradient(ellipse 75% 55% at 50% 0%, black 25%, transparent 72%);
  mask-image: radial-gradient(ellipse 75% 55% at 50% 0%, black 25%, transparent 72%);
}
.lp-rise { opacity: 0; animation: lp-rise 0.7s cubic-bezier(0.16, 0.84, 0.44, 1) forwards; }
.lp-row { opacity: 0; animation: lp-rise 0.6s cubic-bezier(0.16, 0.84, 0.44, 1) forwards; }
.lp-d1 { animation-delay: 0.05s; }
.lp-d2 { animation-delay: 0.13s; }
.lp-d3 { animation-delay: 0.21s; }
.lp-d4 { animation-delay: 0.29s; }
.lp-d5 { animation-delay: 0.37s; }
.lp-d6 { animation-delay: 0.45s; }
.lp-blink { animation: lp-blink 1.6s ease-in-out infinite; }
@keyframes lp-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes lp-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) {
  .lp-rise, .lp-row { animation: none; opacity: 1; }
  .lp-blink { animation: none; }
}
`,
        }}
      />
    </div>
  );
}
