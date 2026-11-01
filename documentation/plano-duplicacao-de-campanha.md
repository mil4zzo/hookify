# Plano — Duplicação de campanha com criativos novos

Documento vivo. Guia a reconstrução da feature de "escolher uma campanha modelo e
lançar criativos novos nela". Atualizar o **Status** ao fim de cada fase — é a
memória do trabalho entre sessões.

Iniciado em 2026-10-30.

---

## Status

| Fase | O quê | Estado |
|---|---|---|
| 0 | Diagnóstico do legado + desenho | ✅ feito (este documento) |
| 1 | Backend: núcleo idempotente e retomável (job + checkpoints) | ✅ código + testes (2026-10-30) |
| 2 | Backend: mídia primeiro — envio do computador em pedaços (relay) | ✅ código (sem teste real) |
| 3 | Backend: Google Drive — listar pasta e importar direto para a Meta | ✅ código (sem teste real) |
| 4 | Frontend: fluxo novo em 3 passos (Modelo → Criativos → Revisar e lançar) | ✅ código (tsc + checker + testes; sem teste no navegador) |
| 5 | Teste real em conta de teste + corte do legado | ⏳ **próximo** — precisa do idealizador (login + conta Meta) |

### Decisões do idealizador (2026-10-30)
- Entrada: tela `/upload` reescrita **+ atalho "Usar como modelo" no Manager**.
- Status padrão das campanhas criadas: **Pausado**.
- Modo legado "Criar anúncios em conjuntos existentes": **remover**.
- Google Drive: **entra já na primeira entrega**.

Riscos em aberto: ver o fim do documento.

---

## 1. O que a feature faz (visão de produto)

O media buyer escolhe **um anúncio que já roda** como modelo. Dele o Hookify herda
tudo o que não é mídia: campanha (objetivo, lance, orçamento), conjuntos (público,
posicionamentos, otimização, agenda), e o criativo (texto, título, CTA, link,
parâmetros de URL, página/Instagram, ajustes por posicionamento).

O usuário traz **criativos novos** (do computador ou de uma pasta do Google Drive).
Para cada criativo nasce **uma campanha cópia** da campanha modelo, com os conjuntos
escolhidos copiados dentro, e em cada conjunto **um anúncio** igual ao modelo — só
que com a mídia nova. É a estrutura clássica de teste "1 criativo por campanha".

---

## 2. Diagnóstico do legado (por que dava problema)

O motor de regras da Meta no legado é bom e foi conquistado a duras penas — limite
de 3 entidades no `/copies`, `explore_home`, transparência de anúncios, troca de
tipo de mídia, upload de vídeo em pedaços, bloqueio de Advantage+. **Isso é
reaproveitado.** Os problemas estão em volta dele:

### 2.1 O caminho da mídia é frágil
- O navegador manda **todos os arquivos num único POST** (até 4 GB por vídeo) para o
  backend; o backend guarda em RAM/arquivo temporário **do processo que recebeu** e
  só então começa a enviar à Meta. Na vida real: subir 2 GB de vídeo é um upload
  único que, se a conexão piscar, recomeça do zero; e o VPS segura o arquivo inteiro.
- O job roda numa thread dentro de 1 dos 4 processos do backend. **Um deploy no
  meio mata o job** e os arquivos temporários somem — não há retomada.

### 2.2 O job não é idempotente
- "Tentar novamente" reprocessa o item **do zero**: copia a campanha de novo. Se a
  falha foi no 3º conjunto, a conta fica com uma campanha meio montada **e** ganha
  outra. Não guardamos o id da campanha criada (`bulk_ad_items` não tem
  `meta_campaign_id`), então nem dá para mostrar link ou limpar.

### 2.3 A tela tem bugs que quebram a confiança
- Status padrão **ATIVO** — campanhas iam ao ar sem querer.
- Trocar de modelo não limpava os slots do modelo anterior (enviava slot fantasma).
- Voltar um passo **apagava as edições** da revisão.
- Recarregar a página perdia o job (a retomada só olhava o endpoint do outro modo).
- O filtro de "transparência de anúncios" podia ser burlado no passo de conjuntos.
- Nenhum link para o que foi criado; proporção dos slots não aplicada (classe
  dinâmica do Tailwind que não gera CSS); erros de rede silenciosos.
- Orçamento: só diário e só de campanha (CBO), pré-preenchido mesmo em ABO.

### 2.4 Fidelidade ao modelo incompleta
- O anúncio novo é criado só com `{name, adset_id, creative, status}` — ajustes do
  anúncio modelo além do criativo ficam para trás.
- O criativo é remontado a partir de uma lista fixa de campos; ajustes novos da Meta
  (ex.: melhorias automáticas de criativo) não são lidos nem replicados.
- Detalhes na seção 4.

### 2.5 Código morto
- Modo "Criar anúncios em conjuntos existentes" desabilitado desde abril, com seus
  componentes, endpoints e hook (`/bulk-ads`, `BulkReviewTable`, `BundleUploadZone`,
  `FileUploadZone`, `AdTree`, `useBulkCreate`).

---

## 3. Arquitetura nova

### 3.1 Princípio: "mídia primeiro"
A mídia vai para a **biblioteca da conta na Meta antes** do job de criação. O job
só trabalha com ids (`image_hash` / `video_id`) — fica leve, rápido e retomável.

- **Do computador:** o navegador conduz o upload em pedaços. Para vídeo, o backend
  abre a sessão `/advideos` na Meta e o navegador manda pedaço a pedaço (do tamanho
  que a Meta pede); o backend repassa cada pedaço direto à Meta, sem gravar em disco.
  Se a conexão cair, retoma do último pedaço aceito. Imagem: 1 envio para `/adimages`.
- **Do Google Drive:** o usuário cola o link da pasta; o backend lista os arquivos
  (nome, tamanho, dimensões, duração, miniatura) e **ele mesmo** baixa do Drive em
  pedaços e empurra para a Meta. Nada passa pelo navegador nem pela internet do
  usuário — um vídeo de 1 GB não depende do Wi-Fi de quem está lançando.
- **Biblioteca de mídias enviadas** (tabela nova): guarda `conta + origem + impressão
  digital → image_hash/video_id`. Relançar o mesmo arquivo na mesma conta custa zero
  envio. No Drive a impressão digital é o `md5Checksum` que o próprio Drive fornece.

### 3.2 Job idempotente e retomável
- Cada criativo vira um **item** com checkpoints persistidos a cada passo:
  `criativo criado → campanha copiada → conjunto N copiado → anúncio N criado`.
- Retomar = continuar do último checkpoint. "Tentar novamente" **nunca** duplica
  campanha: se a campanha já existe, segue para o conjunto que faltou.
- Retomada automática no poll (mesmo padrão do refresh de pack: lease expirado →
  quem consulta o progresso reassume o job). Deploy no meio deixa de ser perda.
- Itens processados em sequência (1 conta, chamadas leves); a Meta é o gargalo, não nós.

### 3.3 Pré-voo antes de gastar qualquer chamada de escrita
Validado ao escolher o modelo (e de novo no servidor ao lançar):
Advantage+ bloqueado, página administrada pelo usuário, transparência de anúncios,
criativo suportado (família/slots), orçamento coerente com CBO/ABO e moeda da conta,
limite de itens. Erro de pré-voo aparece na tela antes do clique em "Lançar".

### 3.4 Agrupamento automático de mídias em criativos
Modelos com mais de um slot (ex.: Feed 4:5 + Stories/Reels 9:16) recebem mídias
agrupadas automaticamente: mesmo nome-base (`AD01_feed.mp4` + `AD01_story.mp4`) vira
um criativo, e cada arquivo cai no slot pela **proporção real** (o Drive informa
largura/altura; no computador o navegador lê do arquivo). O usuário só corrige o
que o automático errar.

### 3.5 Dados
- Reaproveita `jobs` (estado/progresso/lease).
- Tabela nova de itens com checkpoints (ids da campanha, criativo, conjuntos e
  anúncios criados) — substitui o uso de `bulk_ad_items` neste fluxo.
- Tabela nova da biblioteca de mídias enviadas.
- Migration 182.

---

## 4. Fidelidade ao modelo

Pesquisa na fonte oficial (SDK Python da Meta v26.0.2 + changelog), 2026-10-30.

### 4.1 Decisão: copiar o ANÚNCIO modelo trocando só a mídia
`POST /{template_ad_id}/copies` aceita `adset_id`, `status_option` e
`creative_parameters` — "entradas usadas para construir o criativo do anúncio novo;
a sobrescrita é no nível de cima; sem nada, o criativo é idêntico ao da origem".

Na prática: o anúncio novo nasce **clone do modelo** (rastreamento, domínio de
conversão, melhorias automáticas de criativo, multi-anunciante, parâmetros de URL,
identidade de página/Instagram, tudo) e nós sobrescrevemos **só** o bloco de mídia:
`object_story_spec` inteiro (criativo simples) ou `asset_feed_spec` inteiro
(criativo com ajuste por posicionamento). Uma chamada no lugar de duas
(criativo + anúncio), e sem precisar reproduzir à mão ~80 chaves de "melhorias
Advantage+" que a Meta muda todo trimestre.

Por que não montar do zero (o legado): a lista de campos de fidelidade cresce a
cada versão (`degrees_of_freedom_spec`, `contextual_multi_ads` — que vira **ligado
por padrão** se omitido —, `tracking_specs`, `conversion_domain`,
`creative_audience_pairing_persona`…). Cópia herda tudo por construção.

**Fallback** (o `/copies` valida mais estrito que o create — já nos custou o caso
`explore_home`): se a cópia do anúncio falhar por validação, cria criativo +
anúncio manualmente levando os campos de fidelidade explícitos:
- criativo: `object_story_spec`/`asset_feed_spec` com a mídia nova, `url_tags`,
  `degrees_of_freedom_spec` (só `creative_features_spec`, cada chave com
  `enroll_status` explícito, sem `standard_enhancements`), `contextual_multi_ads`;
- anúncio: `tracking_specs`, `conversion_domain`.

### 4.2 Capa do vídeo
O legado mantinha a `image_url` do `video_data` do modelo → **o vídeo novo saía com
a capa do vídeo antigo**. Agora: depois que a Meta processa o vídeo, lemos
`GET /{video_id}/thumbnails`, pegamos a preferida, subimos em `/adimages` e usamos
o `image_hash` (a Meta pede para não usar URL do CDN dela). Fica guardado na
biblioteca de mídias — uma vez por vídeo.

### 4.3 Mudanças da Meta que afetam a cópia (v24 → v26)
- `instagram_actor_id` não existe mais (desde 2025-09-09) → só `instagram_user_id`.
- Cópia de ASC/AAC bloqueada em todas as versões desde 2026-05-19 (já barramos).
- v26: cópia de conjunto em campanha com público restrito exige `advantage_audience`
  explícito; posicionamentos Messenger Stories e Instagram Explore Feed removidos;
  enquete interativa rejeitada no criativo (todas as versões desde 2026-10-27).
  → erros desses casos precisam de mensagem clara (categoria "trocar modelo").

### 4.4 Correção de bug achado no caminho
O aviso de "conta exige transparência de anúncios" lê
`ad_accounts.requires_ads_transparency`, mas **nenhum código grava essa flag** — o
tratamento reativo do subcode 3858495 se perdeu. Volta no núcleo novo.

---

## 5. Fluxo de tela (3 passos)

1. **Modelo** — busca do anúncio (por pack/nome/conjunto/campanha). Ao escolher,
   cartão com o que será herdado e a estrutura da campanha; conjuntos com caixa de
   seleção (os sem transparência, quando a conta exige, aparecem bloqueados com o
   motivo). Pré-voo roda aqui.
2. **Criativos** — origem em abas: *Computador* | *Google Drive*. Mídias viram
   cartões de criativo (agrupamento automático), cada um com nome e slots. O envio
   das mídias do computador começa **já aqui**, em segundo plano, enquanto o
   usuário revisa — quando chegar ao fim, boa parte já está na Meta.
3. **Revisar e lançar** — nomes por modelo com prévia ao vivo (`{ad_name}`,
   `{index}`, `{template_adset_name}`), status (padrão **Pausado**), orçamento,
   resumo "X campanhas · Y conjuntos · Z anúncios". Lançar.

Progresso: um cartão por criativo com os passos e **links para o Gerenciador de
Anúncios** de cada campanha criada. Sobrevive a recarregar a página.

---

## 6. Fases (detalhe)

### Onde está o código (Fases 1–3)
- `supabase/migrations/182_duplicacao_de_campanha.sql` — `campaign_launch_items`
  (checkpoints) e `ad_media_library` (biblioteca/dedupe). **Aplicar antes do deploy
  do backend.**
- `backend/app/services/campaign_launch_service.py` — processador (checkpoints,
  cópia do anúncio com `creative_parameters`, fallbacks explore_home / criação
  manual / transparência).
- `backend/app/services/creative_media_swap.py` — troca de mídia no criativo
  (extraído do legado + capa do vídeo novo + `degrees_of_freedom_spec` limpo).
- `backend/app/services/ad_media_library.py` — imagem, vídeo em pedaços (relay),
  processamento + capa, espera no job.
- `backend/app/services/google_drive_service.py` — pasta (subpasta = criativo,
  atalhos, Drive compartilhado) e leitor por Range Drive→Meta.
- `backend/app/routes/campaign_launch.py` — endpoints (lista no topo do arquivo).
- `backend/tests/test_campaign_launch.py` — 19 testes; os de retomada foram
  sabotados (checkpoint removido) e falharam como deviam.

### Fase 1 — núcleo do job
- Migration 182 (itens com checkpoints + biblioteca de mídias).
- Serviço novo de duplicação reaproveitando do legado: cópia de campanha/conjunto
  com fallback `explore_home`, construtores de criativo, regras de schedule expirado,
  compliance, categorias de erro.
- Endpoints: pré-voo do modelo, lançar (só ids de mídia — sem arquivo), progresso
  (com retomada), tentar de novo, cancelar.
- Testes: checkpoint/retomada (incluindo teste sabotado: falha no 2º conjunto →
  retomada não recopia campanha).

### Fase 2 — envio do computador
- `POST /media/image` (→ hash), `POST /media/video/start|chunk|finish` (relay),
  com dedupe pela biblioteca.

### Fase 3 — Google Drive
- Listar pasta (Drive compartilhado, atalhos, só imagem/vídeo, metadados).
- Importação servidor→Meta em pedaços com leitura por faixa (Range) do Drive.
- Usa a conexão Google que já existe (escopo `drive.readonly` já concedido).

### Fase 4 — tela nova
- Página `/upload` reescrita com componentes novos; legado removido.

### Onde está o código (Fase 4)
- `frontend/app/upload/page.tsx` — página (lê `?ad=` do atalho do Manager).
- `frontend/components/launch/` — `LaunchWizard`, `TemplateStep`, `CreativesStep`,
  `ReviewStep`, `LaunchProgressView`.
- `frontend/lib/campaignLaunch/` — tipos, store (zustand), agrupamento automático
  (`grouping.ts` + 9 testes), enviador em pedaços (`uploader.ts`), pipeline de envio
  (`useMediaPipeline.ts`, vive no assistente para trocar de passo não abortar envio).
- Atalho "Usar como modelo": cabeçalho do `AdDetailsDialog` (anúncio individual, Insider).
- Removidos do frontend: modo "Criar anúncios", `AdTree`, `AdsetSelector`,
  `BulkProgressList`, `BulkReviewTable`, `BundleUploadZone`, `CampaignReviewTable`,
  `FileUploadZone`, `SlotUploadZone`, `useBulkCreate`, `useCampaignBulkCreate`.
- **Backend legado ainda no ar** (`/facebook/bulk-ads*`, `/facebook/campaign-template`,
  `/facebook/campaign-bulk*`, `bulk_ad_service.py`, `campaign_bulk_service.py`): sem
  tela que o chame; sai na Fase 5, depois do teste real.

### Fase 5 — validação real e corte
Roteiro (tudo **pausado**, numa conta de teste):
1. Aplicar a migration 182; subir backend + frontend.
2. Modelo de 1 slot com vídeo → 2 criativos do computador → lançar. Conferir no
   Gerenciador: campanha/conjuntos/anúncio, texto/CTA/link/UTM iguais ao modelo,
   **capa do vídeo novo** (não a do modelo), melhorias Advantage+ iguais.
3. Mesmo modelo, imagem no lugar de vídeo (troca de tipo).
4. Modelo multi-slot (Feed + Stories) via pasta do Drive com `AD01_feed`/`AD01_story`.
5. Modelo CBO e modelo ABO com orçamento sobrescrito.
6. Retomada: reiniciar o backend no meio de um lançamento de 3 criativos → reabrir a
   tela → conferir que não nasceu campanha duplicada.
7. Olhar nos logs `[CAMPAIGN_LAUNCH] ad_copy_fallback`: se a cópia de anúncio com
   `creative_parameters` cair sempre no fallback, entender o porquê antes do corte.
8. Corte: remover o backend legado listado acima + `bulk_ad_items` (migration).
- Lançamento real pausado em conta de teste, cobrindo: modelo de 1 slot, modelo
  multi-slot, imagem em slot de vídeo, CBO e ABO, retomada após derrubar o backend.
- Remover `/bulk-ads`, `/campaign-bulk` e componentes legados.

---

## 7. Decisões em aberto / riscos
- **Escopo `drive.readonly` é "restrito" no Google**: app em produção precisa de
  verificação do Google (com avaliação de segurança anual). Já é pedido hoje pela
  integração de planilhas — confirmar o status de verificação do app no Google Cloud.
- Mídias órfãs na Meta (enviadas mas lançamento abandonado) não são apagadas —
  ficam na biblioteca e são reaproveitadas pela dedupe.
- `POST /{ad_id}/copies` com `creative_parameters` é documentado, mas nunca rodou
  no Hookify — a Fase 5 (teste real pausado) é o que prova. Fallback manual existe
  para não depender disso.
- **Fora do escopo, urgente:** o backend inteiro usa a Graph API **v24.0**, que
  chegou ao fim de vida para Marketing API (changelog: 2026-10-06 ou 2026-11-10,
  as duas páginas da Meta divergem). Upgrade para v25/v26 é tarefa própria.
