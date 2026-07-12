# Ideias Futuras — Hookify

Anotações de ideias para desenvolvimento futuro. Sem ordem de prioridade, sem compromisso de prazo — só para não perder.

---

## Produto / Features

### Marketplace de Anúncios ("Troca de Figurinhas") — 2026-06-28

Permitir que usuários vendam, troquem ou cedam gratuitamente anúncios que já rodaram dentro do Hookify.

**Como funcionaria:**
- **Venda pública (marketplace):** usuário lista um anúncio com um preço. Qualquer outro usuário pode comprar. Hookify cobra uma taxa sobre a transação.
- **Envio privado:** vendedor/doador oferece diretamente para um usuário específico (link ou busca por conta).
- **Freebie/isca:** opção de liberar gratuitamente — pensado para criadores de conteúdo construírem audiência/reputação na plataforma.

**Vitrine (o que fica visível antes da compra):**
- Métricas de performance: CPM, CPR, CPC, CTR, Hook Rate, Hold Rate, CPMQL, etc.
- Funil: faturamento estimado, valor gasto, tempo de veiculação.
- Contexto: nicho, formato (vídeo/imagem), idioma.
- A mídia em si (vídeo/criativo) fica oculta até a compra/aceite.

**Diferencial competitivo:** as métricas são 100% verificáveis — vêm direto da Meta API via Hookify, não são autodeclaradas pelo vendedor. Isso resolve o maior problema de marketplaces de criativos hoje (métricas falsas/infladas).

**Filtros/ordenações sugeridos para o marketplace:** nicho, formato, faixa de CPR, faixa de CTR, valor gasto mínimo, tempo de veiculação, preço.

**Questões em aberto:**
- Definir taxa Hookify (% fixa ou tier do vendedor?).
- O que o comprador recebe exatamente: o vídeo bruto? O adset configurado? Exportação para uso no próprio Ads Manager?
- Moderação: o que impede anúncios de produtos proibidos/enganosos de serem listados?
- Precificação sugerida ao vendedor: Hookify poderia sugerir um preço com base nas métricas.

### Área de Educação — Hookify Academy — 2026-06-28

Plataforma de aulas integrada ao Hookify, ensinando usando o próprio produto como laboratório prático. Duas abordagens complementares (não excludentes):

**Abordagem A — Aulas convencionais (Academy):**

**Trilhas de conteúdo sugeridas:**
- Leitura de métricas (CPM, CPR, CTR, Hook Rate, Hold Rate, ROAS)
- Análise de dados e diagnóstico de campanhas
- Tracking e atribuição
- CRO (Conversion Rate Optimization)
- Copywriting para anúncios
- Tráfego pago (estratégia, estrutura de campanha, escala)

**Diferencial:** as aulas não são genéricas — os exemplos e exercícios usam os dados reais do próprio usuário dentro do Hookify. "Abra o Explorer e olhe para o seu anúncio X" em vez de prints genéricos.

**Modelos de acesso possíveis:**
- Incluído no plano (benefício de retenção).
- Tier separado / upsell (Hookify Academy como produto).
- Aulas gratuitas como isca de aquisição (topo de funil).

---

**Abordagem B — Modo Aprendizado (Learning Mode):**

Um botão/toggle na interface que ativa um modo especial: os cliques nos elementos do Hookify, em vez de executarem sua função normal, abrem um tooltip ou modal contextual explicando o que aquele elemento é, o que a métrica significa, por que ela importa, e o que fazer com ela.

**Exemplos de comportamento no modo ativo:**
- Clicar em "CPR" → modal: "Custo por Resultado. Representa quanto você pagou por cada conversão. Abaixo de R$X no seu nicho é considerado eficiente. O seu benchmark atual é..."
- Clicar no gráfico de Hook Rate → explicação do conceito + o que um bom hook rate indica + dicas de como melhorar.
- Clicar em um botão de ação (ex: "Pausar anúncio") → em vez de pausar, explica quando e por que pausar um anúncio faz sentido.

**Por que é poderoso:**
- O contexto é 100% relevante: a explicação está amarrada exatamente ao objeto que o usuário estava olhando, com os dados reais dele na tela.
- Reduz a barreira de entrada para usuários menos experientes sem poluir a interface para os experientes.
- Pode substituir ou complementar onboarding tradicional — em vez de um tour linear, o usuário explora no próprio ritmo e aprende o que toca.

**Detalhes de UX a definir:**
- Indicador visual claro de que o modo está ativo (ex: ícone de capelo/livro no header, borda ou overlay sutil na tela).
- Toggle global acessível de qualquer página (header ou atalho de teclado).
- Elementos interativos que não têm conteúdo educacional ainda → comportamento padrão ou badge "em breve".
- Possível integração com a Academy: ao final de um tooltip, link para "ver aula completa sobre este tema".

---

### Aulas Personalizadas com IA Generativa de Vídeo — 2026-06-28

Extensão da Hookify Academy: personalização de vídeo em escala usando geração de vídeo com IA.

**MVP (nível 1 — nome):**
- Ao iniciar uma aula, o sistema gera um clipe de ~3 segundos com o instrutor falando o nome do usuário ("Olá, [Nome]!").
- Esse clipe é fundido ao início do vídeo da aula via edição de vídeo programática.
- Resultado: cada usuário recebe uma aula que começa com seu nome, sem custo de gravação manual.

**Nível 2 — contexto do negócio:**
- Usar dados do perfil do usuário no Hookify (nicho, produto, conta de ads) para inserir exemplos personalizados ao longo da aula.
- Ex.: "No seu caso, que vende [produto] para [nicho], o benchmark de CPR ideal seria..."
- Pode ser gerado via narração TTS + slides dinâmicos ou segmentos de vídeo intercalados.

**Nível 3 — análise dos dados reais:**
- A aula analisa literalmente os dados do usuário: "Olhando os seus últimos 30 dias, o seu Hook Rate médio é X, que está abaixo do benchmark de Y..."
- Combina análise automatizada (já temos os dados) com narração gerada por IA.

**Tecnologias candidatas:** ElevenLabs / HeyGen / Tavus para geração de vídeo personalizado; FFmpeg para merge; pipeline assíncrono (job queue) para renderização sob demanda.

**Questões em aberto:**
- Custo de geração por usuário — viável só com volume ou como feature premium.
- Latência: geração na primeira vez que o usuário acessa a aula (on-demand) ou pré-gerado em background?
- Cache: reusar o clipe gerado se o nome/contexto não mudou.

### Jogo de Trunfo com Anúncios como Cartas — 2026-07-11

Mini-jogo (Top Trumps / "trunfo") usando os anúncios como cartas. Dois jogadores recebem o mesmo número de cartas (anúncios) e, a cada rodada, um dos jogadores escolhe uma métrica: quem tiver o anúncio com o melhor valor na métrica escolhida vence a rodada.

**Nota:** ideia de baixa prioridade / provavelmente pouco útil — registrada só para não perder.

---

## UX / Design

## Infraestrutura / Tech

## Integrações

## Monetização / Growth

---

*Última atualização: 2026-07-11*
