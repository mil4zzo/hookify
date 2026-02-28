import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSiteOrigin, getSiteUrl } from "@/lib/utils/siteUrl";

const SITE_URL = getSiteUrl();

type CopyVariantId = "v1" | "v2";

function getCopyVariant(searchParams?: Record<string, string | string[]>): CopyVariantId {
  const raw = searchParams?.v;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "v2") return "v2";
  return "v1";
}

function getCopy(variant: CopyVariantId) {
  const variants = {
    v1: {
      heroKicker: "Análise de criativos. Sem achismo.",
      heroTitle: "Pare de “sentir” campanha.\nComece a enxergar anúncios.",
      heroSubtitle:
        "Importe seus anúncios da Meta, organize em Packs e compare performance com métricas que importam (Hook, CTR, CPR e mais).",
      ctaPrimary: "Começar agora",
      ctaSecondary: "Ver como funciona",
      sectionOutcomeTitle: "O que muda quando você usa Hookify",
      sectionOutcomeItems: [
        { title: "Decisão rápida", desc: "Você sabe o que escalar — e o que cortar." },
        { title: "Criativo no centro", desc: "Ranking claro por Hook, CTR, CPR, CPMQL e afins." },
        { title: "Dados enriquecidos", desc: "Puxe leadscore/CPR Máx do Google Sheets e conecte com o anúncio certo." },
      ],
    },
    v2: {
      heroKicker: "Tráfego bom. Relatório ruim.",
      heroTitle: "Seu melhor anúncio não está no feeling.\nEstá nos dados.",
      heroSubtitle:
        "Hookify transforma campanhas em um placar: compare anúncios, encontre padrões e otimize sem perder tempo em planilha infinita.",
      ctaPrimary: "Criar minha conta",
      ctaSecondary: "O que é um Pack?",
      sectionOutcomeTitle: "Você ganha clareza — e uma vantagem injusta",
      sectionOutcomeItems: [
        { title: "Menos ruído", desc: "Métricas na mesma língua. Sem caça ao número." },
        { title: "Mais previsibilidade", desc: "Entenda performance por período, conta e filtros." },
        { title: "Qualidade do lead", desc: "Traga contexto externo via Sheets para medir o que realmente vale." },
      ],
    },
  } as const;

  return variants[variant];
}

export const metadata: Metadata = {
  metadataBase: getSiteOrigin(),
  title: "Hookify — análise de anúncios da Meta sem achismo",
  description:
    "Importe anúncios da Meta, organize em Packs, ranqueie por métricas (Hook, CTR, CPR) e enriqueça dados via Google Sheets para decidir o que escalar.",
  alternates: { canonical: "/pv" },
  openGraph: {
    type: "website",
    url: "/pv",
    title: "Hookify — análise de anúncios da Meta sem achismo",
    description:
      "Packs, rankings e insights para enxergar performance de anúncios. Enriquecimento via Google Sheets incluso.",
    images: [
      {
        url: "/pv/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Hookify — análise de anúncios da Meta sem achismo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hookify — análise de anúncios da Meta sem achismo",
    description:
      "Packs, rankings e insights para enxergar performance de anúncios. Enriquecimento via Google Sheets incluso.",
    images: ["/pv/opengraph-image"],
  },
};

export default async function PvPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const resolvedSearchParams = await searchParams;
  const variant = getCopyVariant(resolvedSearchParams);
  const copy = getCopy(variant);

  const schemaOrg = {
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

  const schemaWebsite = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Hookify",
    url: SITE_URL,
    inLanguage: "pt-BR",
  };

  const schemaPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Página de vendas — Hookify",
    url: `${SITE_URL}/pv`,
    inLanguage: "pt-BR",
    isPartOf: { "@type": "WebSite", url: SITE_URL, name: "Hookify" },
  };

  return (
    <div className="min-h-screen bg-background text-text">
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-14 md:py-20">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([schemaOrg, schemaWebsite, schemaPage]),
          }}
        />

        <div className="mx-auto max-w-6xl space-y-16 md:space-y-20">
          <header className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-border bg-card">
                  Meta Ads
                </Badge>
                <Badge variant="outline" className="border-border bg-card">
                  Packs
                </Badge>
                <Badge variant="outline" className="border-border bg-card">
                  Rankings
                </Badge>
                <Badge variant="outline" className="border-border bg-card">
                  Google Sheets
                </Badge>
              </div>

              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {copy.heroKicker}
              </p>

              <h1 className="text-4xl font-semibold leading-[1.06] tracking-tight md:text-5xl">
                {copy.heroTitle.split("\n").map((line, idx) => (
                  <span key={idx} className="block">
                    {line}
                  </span>
                ))}
              </h1>

              <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
                {copy.heroSubtitle}
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg">
                  <Link href="/signup">{copy.ctaPrimary}</Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <a href="#como-funciona">{copy.ctaSecondary}</a>
                </Button>
                <p className="text-sm text-muted-foreground sm:pl-2">
                  Já tem conta?{" "}
                  <Link className="font-medium text-primary underline underline-offset-4" href="/login">
                    Entrar
                  </Link>
                </p>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                  Importação assíncrona
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-info" aria-hidden="true" />
                  Cache local para velocidade
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-attention" aria-hidden="true" />
                  Enriquecimento em lote
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <Card className="relative overflow-hidden">
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Placar do criativo</CardTitle>
                  <CardDescription>Comparação direta. Sem scroll infinito.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-border bg-background/40 p-4">
                    <div className="grid grid-cols-[1fr_repeat(3,auto)] items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Anúncio</div>
                      <div className="text-right">Hook</div>
                      <div className="text-right">CTR</div>
                      <div className="text-right">CPR</div>
                      <div className="col-span-4 h-px bg-border" />
                      <div className="font-mono text-foreground">HOOK_07 • UGC</div>
                      <div className="text-right font-mono text-foreground">0.38</div>
                      <div className="text-right font-mono text-foreground">2.1%</div>
                      <div className="text-right font-mono text-foreground">R$ 12</div>
                      <div className="font-mono text-foreground">HOOK_03 • Oferta</div>
                      <div className="text-right font-mono text-foreground">0.31</div>
                      <div className="text-right font-mono text-foreground">1.7%</div>
                      <div className="text-right font-mono text-foreground">R$ 15</div>
                      <div className="font-mono text-muted-foreground">HOOK_02 • Depoimento</div>
                      <div className="text-right font-mono text-muted-foreground">0.24</div>
                      <div className="text-right font-mono text-muted-foreground">1.2%</div>
                      <div className="text-right font-mono text-muted-foreground">R$ 19</div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Seu trabalho vira isso: <span className="text-foreground font-medium">comparar</span>,{" "}
                    <span className="text-foreground font-medium">entender</span>,{" "}
                    <span className="text-foreground font-medium">agir</span>.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="text-xl">Packs = contexto</CardTitle>
                  <CardDescription>Período + conta + filtros. O resto é ruído.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-card p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Pack
                      </p>
                      <p className="mt-1 text-sm font-medium text-foreground">Black Friday • 7 dias</p>
                      <p className="mt-1 text-sm text-muted-foreground">Conta: Principal</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Enriquecimento
                      </p>
                      <p className="mt-1 text-sm font-medium text-foreground">Leadscore + CPR Máx</p>
                      <p className="mt-1 text-sm text-muted-foreground">Via Google Sheets</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </header>

          <section className="space-y-8">
            <header className="space-y-3">
              <h2 className="text-3xl font-semibold">{copy.sectionOutcomeTitle}</h2>
              <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                Não é “mais um dashboard”. É um jeito mais inteligente de decidir com o que você já tem.
              </p>
            </header>

            <div className="grid gap-4 md:grid-cols-3">
              {copy.sectionOutcomeItems.map((item) => (
                <Card key={item.title} className="shadow-sm">
                  <CardHeader className="gap-2">
                    <CardTitle className="text-xl">{item.title}</CardTitle>
                    <CardDescription className="text-sm leading-relaxed">{item.desc}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </section>

          <section id="como-funciona" className="scroll-mt-24 space-y-8">
            <header className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Simples. Do jeito certo.
              </p>
              <h2 className="text-3xl font-semibold">Como funciona</h2>
              <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                Você não precisa mudar seu processo. Você só precisa trocar o método de leitura.
              </p>
            </header>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">1) Crie um Pack</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Escolha conta, período e filtros. O Hookify importa tudo em job assíncrono.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">2) Compare e ranqueie</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Veja performance por métricas de vídeo, clique e conversão — lado a lado.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">3) Enriquecer (opcional)</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Conecte Google Sheets e traga leadscore/CPR Máx. Decisão com contexto de negócio.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          <section className="space-y-8">
            <header className="space-y-3">
              <h2 className="text-3xl font-semibold">Diferenciais que viram rotina</h2>
              <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                O Hookify foi desenhado para volume de dados, rapidez de leitura e ação.
              </p>
            </header>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Importação assíncrona</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Jobs por lotes para lidar com muito anúncio sem travar seu fluxo.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Cache local</CardTitle>
                  <CardDescription className="leading-relaxed">
                    IndexedDB para acesso rápido — e sincronização com o servidor.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Atualização do Pack</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Refresh manual a qualquer momento e auto-refresh quando o período termina em “hoje”.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Enriquecimento em lote</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Atualizações agrupadas por similaridade para ganhar eficiência (e estabilidade).
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          <section className="space-y-8">
            <header className="space-y-3">
              <h2 className="text-3xl font-semibold">FAQ (curto e sem enrolação)</h2>
              <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                Se você pensou, a gente já ouviu.
              </p>
            </header>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Para quem é?</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Para quem roda Meta Ads e precisa decidir com clareza: gestor, tráfego, performance e time de criativos.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Dá para começar rápido?</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Sim. Conecte sua conta Meta, crie um Pack e aguarde a importação assíncrona finalizar.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Precisa de Google Sheets?</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Não. É opcional — mas vira ouro quando você quer medir qualidade do lead e limites de CPR.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="text-xl">Isso substitui minha planilha?</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Substitui o que é repetitivo. E melhora o que importa: leitura, comparação e decisão.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-8 md:p-10">
            <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Última tela antes da clareza
                </p>
                <h2 className="text-3xl font-semibold">Crie sua conta e rode o primeiro Pack hoje</h2>
                <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
                  Você vai abrir o Hookify e pensar: “ok… agora eu sei o que fazer”.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Button asChild size="lg" className="w-full">
                  <Link href="/signup">{copy.ctaPrimary}</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full">
                  <Link href="/docs">Ver docs</Link>
                </Button>
                <p className="text-xs text-muted-foreground">
                  Teste variações de copy: <span className="font-mono">/pv?v=v2</span>
                </p>
              </div>
            </div>
          </section>

          <footer className="flex flex-col gap-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
            <p>
              © {new Date().getFullYear()} Hookify.{" "}
              <Link className="underline underline-offset-4" href="/politica-de-privacidade">
                Privacidade
              </Link>{" "}
              ·{" "}
              <Link className="underline underline-offset-4" href="/termos-de-uso">
                Termos
              </Link>
            </p>
            <p>
              Contato:{" "}
              <a className="underline underline-offset-4" href="mailto:support@hookifyads.com">
                support@hookifyads.com
              </a>
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}

