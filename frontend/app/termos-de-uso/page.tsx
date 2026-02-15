export const metadata = {
  title: "Termos de Uso | Hookify",
  description: "Termos de Uso da plataforma Hookify.",
};

export default function TermsOfUsePage() {
  return (
    <div className="min-h-screen bg-background text-text">
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-3xl space-y-10">
          <header className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Termos de Uso
            </p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
              Termos de Uso - Hookify
            </h1>
            <p className="text-sm text-muted-foreground">
              <strong>Última atualização:</strong> 15 de fevereiro de 2026
            </p>
            <p className="text-base leading-relaxed text-muted-foreground">
              Estes Termos de Uso (&quot;<strong>Termos</strong>&quot;) regem o acesso e uso do{" "}
              <strong>Hookify</strong> (&quot;<strong>Serviço</strong>&quot;), operado por{" "}
              <strong>VICTOR GOMES MILAZZO LTDA</strong> (&quot;<strong>Hookify</strong>&quot;,
              &quot;<strong>nós</strong>&quot;). Ao criar uma conta, acessar ou usar o Serviço, você
              declara que leu, entendeu e concorda com estes Termos.
            </p>
            <p className="text-base leading-relaxed text-muted-foreground">
              Se você não concordar com estes Termos, não utilize o Serviço.
            </p>
          </header>

          {/* 1) Definições */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1) Definições</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Para fins destes Termos:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Conta:</strong> conta individual criada para
                acessar o Serviço.
              </li>
              <li>
                <strong className="text-foreground">Usuário:</strong> pessoa física ou representante
                de pessoa jurídica que acessa ou utiliza o Serviço.
              </li>
              <li>
                <strong className="text-foreground">Meta Ads:</strong> plataforma de anúncios do
                Meta (Facebook/Instagram).
              </li>
              <li>
                <strong className="text-foreground">Conta de anúncio (Ad Account):</strong> conta de
                anúncios conectada ao Usuário via integração autorizada.
              </li>
              <li>
                <strong className="text-foreground">
                  Campanha (Campaign), Conjunto (Ad Set), Anúncio (Ad), Criativo (Creative):
                </strong>{" "}
                termos conforme definidos no ecossistema do Meta Ads.
              </li>
              <li>
                <strong className="text-foreground">Conversão principal (Primary Conversion):</strong>{" "}
                evento-alvo selecionado pelo Usuário no recorte/benchmark.
              </li>
              <li>
                <strong className="text-foreground">Pack:</strong> coleção de anúncios definida por
                filtros + período + conta, criada no Hookify.
              </li>
              <li>
                <strong className="text-foreground">Plano Free / Plano Premium:</strong> modalidades
                de acesso ao Serviço (gratuita e paga).
              </li>
              <li>
                <strong className="text-foreground">Trial:</strong> período de teste do Plano
                Premium por <strong>7 (sete) dias</strong>, quando disponível.
              </li>
            </ul>
          </section>

          {/* 2) Elegibilidade e capacidade */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2) Elegibilidade e capacidade</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              2.1. O Serviço pode ser usado por pessoas físicas e jurídicas.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              2.2. Se você for menor de 18 anos, declara que utiliza o Serviço com ciência e
              consentimento do seu responsável legal, quando exigido pela legislação aplicável.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              2.3. Se você estiver utilizando o Hookify em nome de uma empresa, você declara ter
              poderes para aceitar estes Termos em nome dessa empresa.
            </p>
          </section>

          {/* 3) Conta, acesso e responsabilidades */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3) Conta, acesso e responsabilidades</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              3.1. Você é responsável por manter a confidencialidade da sua Conta e por todas as
              atividades realizadas nela.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              3.2. Você concorda em fornecer informações verdadeiras e atualizadas ao criar e manter
              sua Conta.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              3.3. Você é responsável por garantir que o uso do Hookify, incluindo integração com
              plataformas de terceiros, seja feito de acordo com estes Termos e com as regras
              aplicáveis às suas próprias operações.
            </p>
          </section>

          {/* 4) Escopo do Serviço */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4) Escopo do Serviço</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              4.1. O Hookify é uma plataforma de{" "}
              <strong>importação, organização e análise</strong> de dados de anúncios (Meta Ads),
              com funcionalidades como <strong>Packs, Manager, Insights e G.O.L.D.</strong>, e
              integrações opcionais (ex.: Google Sheets).
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              4.2. O Hookify não é afiliado, patrocinado ou endossado por Meta ou Google.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              4.3. O Serviço pode evoluir com novas funcionalidades e telas. Recursos futuros podem
              incluir a possibilidade de inserir/upload de informações adicionais (ex.: notas,
              copies, briefings), conforme disponibilizado no produto.
            </p>
          </section>

          {/* 5) Integrações com terceiros */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              5) Integrações com terceiros (Meta/Google) e uso de contas conectadas
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              5.1. Para usar determinadas funcionalidades, o Usuário pode conectar integrações por
              OAuth (ex.: Meta e/ou Google).
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              5.2. <strong>Responsabilidade pela conta conectada:</strong> ao conectar uma conta (por
              exemplo, uma conta de anúncios do Meta), você reconhece e concorda que é{" "}
              <strong>integralmente responsável</strong> por essa conexão e por todo uso do Serviço
              associado a ela.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              5.3. O funcionamento do Serviço depende, em parte, de APIs e serviços de terceiros.
              Mudanças, limitações, indisponibilidades ou restrições impostas por terceiros podem
              afetar total ou parcialmente o funcionamento de integrações, sem que isso configure
              descumprimento destes Termos por parte do Hookify.
            </p>
          </section>

          {/* 6) Planos, trial e contratação */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">6) Planos, trial e contratação</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              6.1. O Hookify disponibiliza um <strong>Plano Free</strong> e um{" "}
              <strong>Plano Premium</strong> (pago).
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              6.2. O <strong>Plano Premium</strong> pode incluir um{" "}
              <strong>trial de 7 (sete) dias</strong>, quando habilitado no produto. O trial pode
              estar sujeito a regras de elegibilidade (ex.: uma vez por usuário/conta), informadas
              no momento da assinatura.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              6.3. Detalhes de preços, forma de cobrança, periodicidade e funcionalidades de cada
              plano serão exibidos no momento da contratação e/ou na área de assinatura do Serviço.
            </p>
          </section>

          {/* 7) Pagamentos, renovação e cancelamento */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">7) Pagamentos, renovação e cancelamento</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              7.1. Assinaturas pagas podem ser cobradas de forma recorrente (mensal, anual ou outra
              periodicidade exibida no checkout).
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              7.2. Salvo indicação em contrário, a assinatura do Plano Premium se renova
              automaticamente ao fim de cada ciclo, até que seja cancelada pelo Usuário.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              7.3. O Usuário pode cancelar a assinatura a qualquer momento. O cancelamento
              interrompe renovações futuras, e o acesso Premium permanece ativo até o fim do ciclo
              pago vigente, salvo regra diferente informada no momento da contratação.
            </p>
          </section>

          {/* 8) Garantia e reembolso */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              8) Garantia e reembolso (garantia incondicional)
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              8.1. O Hookify oferece <strong>garantia incondicional de 7 (sete) dias</strong> para o
              Plano Premium.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              8.2. Dentro desse prazo, o Usuário pode solicitar{" "}
              <strong>reembolso integral</strong>, sem necessidade de justificativa, por meio dos
              canais oficiais de suporte (Seção 15).
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              8.3. Quando aplicável, o reembolso seguirá o método de pagamento original e pode
              depender de prazos operacionais do processador de pagamento/banco.
            </p>
          </section>

          {/* 9) Uso aceitável e restrições */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9) Uso aceitável e restrições</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Você concorda em não:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Usar o Serviço para fins ilegais, fraudulentos, abusivos ou que violem direitos de
                terceiros;
              </li>
              <li>
                Tentar burlar controles de segurança, autenticação, limites técnicos, ou acessar
                dados de outros usuários;
              </li>
              <li>
                Explorar vulnerabilidades, realizar varreduras, ataques, ou qualquer ação que
                degrade a infraestrutura do Serviço;
              </li>
              <li>
                Copiar, modificar, distribuir, vender, licenciar, fazer engenharia reversa ou criar
                obras derivadas do Serviço, salvo autorização expressa por escrito;
              </li>
              <li>
                Utilizar o Hookify para coletar/armazenar dados pessoais de terceiros de forma
                incompatível com a legislação aplicável.
              </li>
            </ul>
            <p className="text-sm leading-relaxed text-muted-foreground">
              O Hookify pode impor limites de uso (por exemplo, volume de importação, frequência de
              refresh, quantidade de Packs) para proteção de estabilidade e prevenção de abuso.
            </p>
          </section>

          {/* 10) Propriedade intelectual */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">10) Propriedade intelectual</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              10.1. O Serviço, incluindo software, interfaces, marca, identidade visual, textos,
              gráficos e funcionalidades, pertence ao Hookify ou está licenciado a nós.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              10.2. Estes Termos não transferem ao Usuário qualquer direito de propriedade sobre o
              Serviço. É concedida apenas uma licença limitada, revogável, não exclusiva e
              intransferível para uso do Serviço conforme estes Termos.
            </p>
          </section>

          {/* 11) Privacidade e dados */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">11) Privacidade e dados</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              11.1. O tratamento de dados é regido pela <strong>Política de Privacidade</strong>,
              disponível em:{" "}
              <a
                className="font-medium text-primary underline"
                href="/politica-de-privacidade"
              >
                https://hookifyads.com/politica-de-privacidade
              </a>
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              11.2. Instruções de exclusão de dados (User Data Deletion):{" "}
              <a
                className="font-medium text-primary underline"
                href="https://hookifyads.com/exclusao-de-dados"
                target="_blank"
                rel="noopener noreferrer"
              >
                https://hookifyads.com/exclusao-de-dados
              </a>
            </p>
          </section>

          {/* 12) Disponibilidade e alterações do Serviço */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">12) Disponibilidade e alterações do Serviço</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              12.1. O Serviço é fornecido &quot;<strong>como está</strong>&quot; e &quot;
              <strong>conforme disponível</strong>&quot;, sem garantia de disponibilidade contínua ou
              livre de erros.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              12.2. Podemos atualizar, alterar, adicionar, suspender ou remover funcionalidades por
              razões técnicas, comerciais, de segurança ou conformidade.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              12.3. Quando mudanças forem relevantes, poderemos comunicar por e-mail, dentro do app
              ou em página oficial.
            </p>
          </section>

          {/* 13) Isenções e limitações de responsabilidade */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              13) Isenções e limitações de responsabilidade
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              13.1. O Hookify fornece análises, relatórios e insights com base nos dados
              disponíveis. <strong>Não garantimos</strong> resultados financeiros, performance
              específica ou melhoria de ROAS/CPR/CTR.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              13.2. O Usuário é o único responsável por decisões de mídia, orçamento, criação,
              veiculação, pausar/escalar anúncios e demais ações tomadas com base no Serviço.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              13.3. Na máxima extensão permitida por lei, o Hookify não será responsável por danos
              indiretos, lucros cessantes, perda de receita, perda de dados, interrupção de negócios
              ou qualquer prejuízo decorrente do uso (ou incapacidade de uso) do Serviço.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              13.4. Se e na medida em que a limitação acima não seja aplicável, a responsabilidade
              total do Hookify ficará limitada ao valor efetivamente pago pelo Usuário ao Hookify
              nos <strong>últimos 30 (trinta) dias</strong> anteriores ao evento que originou a
              reclamação.
            </p>
          </section>

          {/* 14) Indenização */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">14) Indenização</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Você concorda em indenizar e isentar o Hookify de reclamações, perdas,
              responsabilidades e despesas decorrentes de:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>uso indevido do Serviço;</li>
              <li>violação destes Termos;</li>
              <li>violação de direitos de terceiros;</li>
              <li>
                ações realizadas por você em contas conectadas sob sua responsabilidade.
              </li>
            </ul>
          </section>

          {/* 15) Suporte e contato */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">15) Suporte e contato</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">Canais oficiais:</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              E-mail:{" "}
              <a
                className="font-medium text-primary underline"
                href="mailto:milazzo@hookifyads.com"
              >
                milazzo@hookifyads.com
              </a>
              ,{" "}
              <a
                className="font-medium text-primary underline"
                href="mailto:support@hookifyads.com"
              >
                support@hookifyads.com
              </a>
              ,{" "}
              <a
                className="font-medium text-primary underline"
                href="mailto:legal@hookifyads.com"
              >
                legal@hookifyads.com
              </a>
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              WhatsApp: +5532998092905
            </p>
          </section>

          {/* 16) Rescisão e suspensão */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">16) Rescisão e suspensão</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              16.1. Você pode parar de usar o Serviço a qualquer momento.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              16.2. Podemos suspender ou encerrar o acesso ao Serviço em caso de violação destes
              Termos, risco de segurança, abuso, fraude ou exigência legal.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              16.3. A exclusão de dados segue a Política de Privacidade e a página de exclusão
              (links na Seção 11).
            </p>
          </section>

          {/* 17) Lei aplicável e foro */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">17) Lei aplicável e foro</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Estes Termos são regidos pelas leis da{" "}
              <strong>República Federativa do Brasil</strong>.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Fica eleito o foro da <strong>Comarca de Ubá/MG</strong>, com renúncia de qualquer
              outro, salvo disposições legais obrigatórias.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
