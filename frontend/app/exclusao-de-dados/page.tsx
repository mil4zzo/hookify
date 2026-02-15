export const metadata = {
  title: "Exclusão de Dados | Hookify",
  description: "Saiba como solicitar a exclusão dos seus dados no Hookify.",
};

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-background text-text">
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-3xl space-y-10">
          <header className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Exclusão de Dados
            </p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
              Exclusão de Dados - Hookify
            </h1>
            <p className="text-sm text-muted-foreground">
              <strong>Última atualização:</strong> 15 de fevereiro de 2026
            </p>
            <p className="text-base leading-relaxed text-muted-foreground">
              Esta página explica como você pode solicitar a{" "}
              <strong>exclusão dos seus dados</strong> relacionados ao uso do Hookify, incluindo
              dados importados do <strong>Meta Ads</strong> e integrações opcionais (ex.: Google
              Sheets).
            </p>
          </header>

          {/* 1) Como solicitar a exclusão */}
          <section className="space-y-6">
            <h2 className="text-xl font-semibold">
              1) Como solicitar a exclusão dos seus dados
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Você pode solicitar a exclusão de 3 formas:
            </p>

            {/* Opção A */}
            <div className="space-y-3">
              <h3 className="text-lg font-medium">
                Opção A — Solicitação por e-mail (recomendado)
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Envie um e-mail para{" "}
                <a
                  className="font-medium text-primary underline"
                  href="mailto:legal@hookifyads.com"
                >
                  legal@hookifyads.com
                </a>{" "}
                com:
              </p>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">Assunto:</strong>{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    Exclusão de Dados - Hookify
                  </code>
                </li>
                <li>
                  <strong className="text-foreground">No corpo do e-mail:</strong> informe o{" "}
                  <strong>e-mail</strong> utilizado para acessar o Hookify.
                </li>
              </ul>
              <blockquote className="border-l-2 border-muted-foreground/30 pl-4 text-sm italic text-muted-foreground">
                Se você tiver mais de uma conta, envie um e-mail para cada uma (ou liste todos os
                e-mails no mesmo pedido).
              </blockquote>
            </div>

            {/* Opção B */}
            <div className="space-y-3">
              <h3 className="text-lg font-medium">
                Opção B — Revogar acesso pelo Facebook (Meta)
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Você pode remover o acesso do Hookify nas configurações do Facebook:
              </p>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  Vá em <strong className="text-foreground">Configurações</strong> →{" "}
                  <strong className="text-foreground">Aplicativos e Sites</strong>
                </li>
                <li>
                  Encontre <strong className="text-foreground">Hookify</strong>
                </li>
                <li>
                  Clique em <strong className="text-foreground">Remover</strong>
                </li>
              </ul>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Isso <strong>revoga o acesso imediatamente</strong>. Se você também quiser que os
                dados armazenados no Hookify sejam apagados, use a <strong>Opção A</strong>.
              </p>
            </div>

            {/* Opção C */}
            <div className="space-y-3">
              <h3 className="text-lg font-medium">
                Opção C — Revogar acesso pelo Google (se você integrou Google Sheets)
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Se você conectou uma conta Google para integração com planilhas, pode revogar o
                acesso:
              </p>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  Acesse as permissões da sua{" "}
                  <strong className="text-foreground">Conta Google</strong>
                </li>
                <li>Remova o acesso do Hookify</li>
              </ul>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Isso interrompe novas sincronizações. Para apagar dados já armazenados no Hookify,
                use a <strong>Opção A</strong>.
              </p>
            </div>
          </section>

          {/* 2) O que será excluído */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2) O que será excluído</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Quando processarmos sua solicitação de exclusão, apagaremos os dados associados à sua
              conta no Hookify, incluindo:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Dados do seu <strong className="text-foreground">perfil</strong> no Hookify (ex.:
                nome, e-mail e foto quando aplicável)
              </li>
              <li>
                <strong className="text-foreground">Tokens de conexão</strong> (Meta e Google,
                quando aplicável)
              </li>
              <li>
                Dados importados e armazenados para análise (ex.:{" "}
                <strong className="text-foreground">packs</strong>,{" "}
                <strong className="text-foreground">anúncios</strong>,{" "}
                <strong className="text-foreground">métricas</strong>, caches e históricos
                associados ao seu usuário)
              </li>
              <li>Configurações e preferências do usuário no Hookify</li>
            </ul>
          </section>

          {/* 3) Prazo de processamento */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              3) Prazo de processamento e confirmação
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Após receber sua solicitação por e-mail (Opção A), o Hookify:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>iniciará o processo de exclusão, e</li>
              <li>
                poderá enviar uma confirmação de conclusão da exclusão para o mesmo e-mail
                solicitante.
              </li>
            </ul>
            <blockquote className="border-l-2 border-muted-foreground/30 pl-4 text-sm italic text-muted-foreground">
              Podemos manter apenas informações estritamente necessárias para cumprir obrigações
              legais, quando aplicável.
            </blockquote>
          </section>

          {/* 4) Contato */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4) Contato</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Se tiver dúvidas sobre exclusão de dados, fale com a gente:
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              <strong>E-mail:</strong>{" "}
              <a
                className="font-medium text-primary underline"
                href="mailto:support@hookifyads.com"
              >
                support@hookifyads.com
              </a>{" "}
              ou{" "}
              <a
                className="font-medium text-primary underline"
                href="mailto:milazzo@hookifyads.com"
              >
                milazzo@hookifyads.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
