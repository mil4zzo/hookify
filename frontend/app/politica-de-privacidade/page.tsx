export const metadata = {
  title: "Política de Privacidade | Hookify",
  description: "Política de Privacidade da plataforma Hookify.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-text">
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-3xl space-y-10">
          <header className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Política de Privacidade
            </p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
              Política de Privacidade - Hookify
            </h1>
            <p className="text-sm text-muted-foreground">
              <strong>Última atualização:</strong> 15 de fevereiro de 2026
            </p>
            <p className="text-base leading-relaxed text-muted-foreground">
              Esta Política de Privacidade descreve como o <strong>Hookify</strong> coleta, usa,
              armazena e protege informações quando você utiliza o Serviço. Ao usar o Hookify, você
              concorda com esta Política.
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1) Quem somos</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Hookify (&quot;nós&quot;, &quot;nossa&quot;), operada por VICTOR GOMES MILAZZO LTDA
              (CNPJ: 48.496.745/0001-10)
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Endereço: Rua Germano Leite, 190, Peluso — Ubá/MG — Brasil.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Contato:{" "}
              <a className="font-medium text-primary underline" href="mailto:milazzo@hookifyads.com">
                milazzo@hookifyads.com
              </a>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2) Quais dados processamos</h2>

            <h3 className="text-lg font-medium">2.1 Dados de conta (login e perfil)</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">Podemos processar:</p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li><strong className="text-foreground">Nome</strong></li>
              <li><strong className="text-foreground">E-mail</strong></li>
              <li><strong className="text-foreground">Foto de perfil</strong> (quando fornecida pelo login social)</li>
            </ul>

            <h3 className="text-lg font-medium">
              2.2 Dados de Anúncios da Meta (Facebook/Instagram) — essenciais para o Serviço
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Quando você conecta sua conta Meta e concede permissões, processamos dados necessários
              para entregar as funcionalidades <strong>Packs, Manager, Insights e G.O.L.D.</strong>,
              incluindo:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Estrutura e identificação de ativos (ex.: IDs e nomes de{" "}
                <strong className="text-foreground">adaccounts, campaign, adset</strong> e{" "}
                <strong className="text-foreground">ad</strong>)
              </li>
              <li>
                Métricas de desempenho (ex.: impressões, alcance, cliques, gastos, conversões,
                custos e métricas derivadas como CPM, CTR, CPR)
              </li>
              <li>
                Informações necessárias para exibir/analisar criativos (ex.: miniaturas,
                identificadores e referências de mídia como vídeo/imagem quando aplicável)
              </li>
            </ul>
            <blockquote className="border-l-2 border-muted-foreground/30 pl-4 text-sm italic text-muted-foreground">
              Nós processamos esses dados <strong>somente</strong> para fornecer as análises e
              relatórios do Hookify ao próprio usuário.
            </blockquote>

            <h3 className="text-lg font-medium">2.3 Dados do Google Sheets (integração opcional)</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Se você optar por integrar, processamos apenas os dados/colunas que você autorizar e
              configurar para enriquecimento (ex.: <strong>leadscore</strong>,{" "}
              <strong>cpr_max</strong>, colunas de match e datas), para melhorar a análise e
              priorização de oportunidades.
            </p>

            <h3 className="text-lg font-medium">2.4 Dados de uso e segurança (logs)</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Podemos coletar automaticamente dados técnicos para segurança e funcionamento, como:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Endereço IP, data/hora de acesso, tipo de navegador/dispositivo, páginas acessadas e
                eventos de erro.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3) Como usamos os dados (finalidades)</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Usamos os dados para:
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Operar e manter o Serviço</strong> (importar
                dados, calcular métricas, exibir dashboards, gerar insights e rankings).
              </li>
              <li>
                <strong className="text-foreground">Gerenciar sua conta</strong> (autenticação,
                preferências e configurações).
              </li>
              <li>
                <strong className="text-foreground">Suporte e comunicações operacionais</strong>{" "}
                (ex.: avisos de expiração de conexão, falhas de sincronização e atualizações
                relevantes).
              </li>
              <li>
                <strong className="text-foreground">
                  Segurança, prevenção de abuso e auditoria
                </strong>
                .
              </li>
              <li>
                <strong className="text-foreground">Benchmarks agregados/anonimizados</strong>:
                podemos gerar estatísticas agregadas que <strong>não identificam</strong> você, sua
                conta de anúncio, anúncios ou criativos, para melhorar o produto e a qualidade dos
                insights.
              </li>
            </ol>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4) Compartilhamento de dados</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Nós <strong>não vendemos</strong> dados pessoais ou dados comerciais.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Podemos compartilhar dados apenas:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Com <strong className="text-foreground">provedores de infraestrutura</strong>{" "}
                necessários para operar o Hookify (ex.: hospedagem, banco de dados, armazenamento e
                logs), sob confidencialidade e medidas de segurança.
              </li>
              <li>
                Para <strong className="text-foreground">cumprimento legal</strong> ou para proteger
                direitos e segurança (ex.: ordens legais e prevenção de fraude).
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">5) Retenção e armazenamento</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Podemos manter <strong className="text-foreground">cache</strong> de métricas e
                dados processados para performance, histórico e comparações.
              </li>
              <li>
                Mantemos dados enquanto for necessário para fornecer o Serviço e suas
                funcionalidades ao usuário.
              </li>
              <li>Você pode solicitar exclusão a qualquer momento (Seção 8).</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">6) Segurança</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Adotamos medidas de segurança para proteger dados, incluindo:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Criptografia/proteção de tokens OAuth</strong>{" "}
                armazenados no banco
              </li>
              <li>
                <strong className="text-foreground">Isolamento lógico por usuário</strong> (controle
                de acesso e políticas de segurança por usuário)
              </li>
              <li>
                <strong className="text-foreground">HTTPS/TLS</strong> para dados em trânsito
              </li>
              <li>Monitoramento e logs para diagnóstico e prevenção de abuso</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">7) Privacidade de crianças</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              O Hookify não é direcionado a menores de 13 anos e não coleta intencionalmente dados
              de menores de 13 anos.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              8) Exclusão de dados (User Data Deletion) e revogação de acesso
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Você pode excluir seus dados e/ou revogar o acesso do Hookify às suas contas
              conectadas.
            </p>
            <p className="text-sm font-medium text-foreground">
              Como solicitar exclusão dos dados do Hookify:
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Via e-mail:</strong> envie para{" "}
                <a
                  className="font-medium text-primary underline"
                  href="mailto:legal@hookifyads.com"
                >
                  legal@hookifyads.com
                </a>{" "}
                com o assunto <strong>&quot;Exclusão de Dados - Hookify&quot;</strong>, informando o
                e-mail da conta usada no Hookify.
              </li>
              <li>
                <strong className="text-foreground">Revogação no Facebook:</strong> você pode
                remover o app nas configurações do Facebook (&quot;Apps e Sites&quot;), o que revoga
                nosso acesso imediatamente.
              </li>
              <li>
                <strong className="text-foreground">Via conta Google (se aplicável):</strong> você
                pode revogar a permissão do Google nas configurações da sua conta Google.
              </li>
            </ol>
            <p className="text-sm font-medium text-foreground">
              O que acontece quando você solicita exclusão:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Excluiremos os dados associados à sua conta (incluindo tokens e dados
                armazenados/caches relacionados).
              </li>
              <li>
                Podemos manter apenas informações estritamente necessárias para cumprir obrigações
                legais, quando aplicável.
              </li>
              <li>
                Você pode ver instruções detalhadas aqui:{" "}
                <a
                  className="font-medium text-primary underline"
                  href="https://hookifyads.com/exclusao-de-dados"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  https://hookifyads.com/exclusao-de-dados
                </a>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9) Alterações desta política</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Podemos atualizar esta Política periodicamente. A data no topo será atualizada sempre
              que houver mudanças.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">10) Contato</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              E-mail:{" "}
              <a className="font-medium text-primary underline" href="mailto:milazzo@hookifyads.com">
                milazzo@hookifyads.com
              </a>
              ,{" "}
              <a className="font-medium text-primary underline" href="mailto:support@hookifyads.com">
                support@hookifyads.com
              </a>
              ,{" "}
              <a className="font-medium text-primary underline" href="mailto:legal@hookifyads.com">
                legal@hookifyads.com
              </a>
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Whatsapp: +5532998092905
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
