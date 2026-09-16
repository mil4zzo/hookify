# Plano pós-157 — o que sobrou da caçada ao "Erro ao carregar variações."

Criado em 2026-09-15, depois de o modal de variações voltar a funcionar. Este arquivo é o
**contrato de retomada**: cada bloco é independente, cabe numa sessão e termina em produção
com medição. Quem pegar isto do zero consegue continuar sem o histórico do chat.

Contexto do problema original e das decisões já tomadas:
`documentation/decisoes-tecnicas.md` (seções de 15/09) e `supabase/migrations/157_detalhe_linear.sql`.
O plano de eficiência (F1..F7) continua em `documentation/plano-eficiencia-carregamento.md`;
o bloco 5 daqui **é** o F2b de lá.

---

## Estado em 15/09 (já feito, não refazer)

| O quê | Estado |
|---|---|
| `fetch_entity_performance_v157` (montagem linear) | 🚢 em produção; backend usa `RPC_NAME = "fetch_entity_performance_v157"`; a v155 segue intacta para rollback |
| Teste `supabase/tests/157_detalhe_linear.test.sql` | ✅ 515 telas idênticas + escala linear; 6 sabotagens provadas (README dos testes) |
| Nome de anúncio com "/" nas rotas `/rankings/ad-name/*` | 🚢 em produção (`b2c3ace`), teste `backend/tests/test_ad_name_route_with_slash.py` |
| `schema.sql` / `schema_map.md` | ✅ sincronizados com produção em 15/09 |

**Medições que não precisam ser refeitas** (produção, 15/09): ADNV89 com 630 anúncios em
21 dias: v155 874–1.737 ms → v157 317 ms. Escala no laboratório (200 → 1.600 anúncios,
8× mais): v157 ~10×, v155 138×.

---

## Bloco 1 — CI de guardas do banco volta a ficar verde

**Por quê.** A migration 154 criou `ad_pack_inventory_backfill(uuid)` com o padrão
`p_x is null or ...` e **sem** `plan_cache_mode = force_custom_plan`. O gate
`check_plan_cache_mode_gaps()` (workflow `.github/workflows/db-guardrails.yml`) falha o build
desde então. Risco real baixo (função de manutenção), risco de processo alto: alarme sempre
vermelho deixa de ser lido.

**Passos**
1. O idealizador instala o `gh` (não está nesta máquina). Conferir:
   `gh run list --workflow db-guardrails.yml --limit 10`.
2. Migration `158_plan_cache_mode_no_backfill_do_inventario.sql`:
   `ALTER FUNCTION public.ad_pack_inventory_backfill(uuid) SET plan_cache_mode TO 'force_custom_plan';`
3. Aplicar em produção e conferir `select * from public.check_plan_cache_mode_gaps()` → **zero linhas**.
4. Commit + push; confirmar o workflow verde no `gh`.

**Pronto quando:** gate sem lacunas e último run verde. Sem deploy de backend.

---

## Bloco 2 — Repetir só quando o trabalho não aconteceu

**Por quê.** `with_postgrest_retry` repete também em `ReadTimeout`. Medido em produção em
15/09: quando o backend desiste, **a consulta continua rodando no banco por mais de 1 s**
(teste com cliente desistindo em 0,15 s numa leitura de ~3 s). Resultado no incidente de
14/09: 4 tentativas de 15 s da mesma consulta de 18 s — 1 minuto de espera para o usuário e
até 4 cópias no banco. Repetir só ajuda quando o trabalho não aconteceu (queda de conexão,
deadlock, erro rápido de API externa).

**Passos**
1. `backend/app/core/supabase_retry.py`: separar as classes de falha. Repetir
   `ConnectError`, `ConnectTimeout`, `RemoteProtocolError`, `ReadError`, `PoolTimeout` e
   deadlock (40P01). **Não** repetir `ReadTimeout`/`WriteTimeout` — com escape explícito por
   chamada, se aparecer um caso que precise.
2. Alinhar os limites para não sobrar consulta órfã: hoje o backend espera 15 s
   (`POSTGREST_TIMEOUT_SECONDS`), `authenticated` corta em 30 s, `service_role` herda 8 s do
   `authenticator` e `detect_pack_conflicts` tem 25 s próprios. Decidir por rota: ou o banco
   corta antes (statement_timeout por função), ou o backend espera mais que o banco.
3. Testes em `backend/tests/`: contar tentativas por tipo de erro (timeout = 1; queda de
   conexão = 4; deadlock = 4). **Sabotagem obrigatória:** voltar o `ReadTimeout` para a lista
   e conferir que o teste falha.
4. Deploy do backend. Acompanhar o log por `supabase_retry:` nas 24 h seguintes.

**Cuidado.** O helper embrulha ~98 chamadas, incluindo **escritas** (upserts do refresh). Para
escrita, tempo esgotado é ambíguo: pode ter gravado. Decidir explicitamente (os upserts são
idempotentes) e registrar a decisão no código.

**Pronto quando:** testes passam, sabotagem falha, backend no ar sem novo 500 por esse caminho.

---

## Bloco 3 — Resposta das variações mais leve

**Por quê (medido em 15/09, ADNV89 com 630 anúncios).** A resposta tem 1.636 KB crus, 130 KB
na rede. **Metade é a mini-série de 5 dias por anúncio, que a tabela de variações não
desenha** — ela só é usada ao clicar numa variação (1 de 630). E comprimir no nível 9 custa
60 ms por resposta; no nível 6 custa 8 ms e o arquivo fica 12% maior.

| | Atual | Esperado |
|---|---|---|
| Saída do banco | 1.481 KB | 908 KB |
| Resposta crua | 1.636 KB | 898 KB |
| Na rede | 130 KB | 74 KB |
| Compressão | 60 ms | 8 ms |

**Passos**
1. Backend: as rotas de filhos (`/rankings/ad-name/{nome}/children` e
   `/rankings/adset-id/{id}/children`) chamam a RPC com `series_days=0` e devolvem `series: null`.
   Conferir antes se `series_days=0` faz a v157 não montar os dias (`v_series_start`).
2. Frontend: em `components/ads/AdDetailsDialog.tsx`, a série dos mini-gráficos passa a vir do
   detalhe por anúncio (`useAdDetails`, que já é buscado na aba de vídeo) em vez de `ad.series`.
   Remover o plano B de conversões em `ManagerChildrenTable.tsx` (linhas ~217-226), que lê a série.
3. `backend/app/main.py`: `GZipMiddleware(compresslevel=6)`.
4. Testes: (a) comparar a resposta real da rota antes/depois campo a campo — só `series` pode
   mudar; (b) teste de frontend de que a tabela não depende da série; (c) conferir no app que
   os mini-gráficos aparecem ao abrir uma variação; (d) medir bytes e tempo antes/depois.

**Pronto quando:** medição confirma os números acima e os mini-gráficos continuam aparecendo.

---

## Bloco 4 — `detect_pack_conflicts`: a afinação barata

**Por quê (medido em 15/09).** Depois do F5 a função caiu para 0,5–0,8 s nos 38 packs do Igor
(antes: média 4,6 s, pior caso 19,7 s). O que sobra de desperdício: lê as **142 mil linhas de
anúncio-dia de todos os packs** para responder **0 conflitos**, ordena 7 MB em disco e faz 156
mil idas extras à tabela porque a limpeza automática não passa no mapa desde 07/09 — antes da
exclusão em massa da 156. O plano de eficiência já listava isto como "afinação barata,
independente do resto" (§5, riscos do F2b).

**Passos**
1. **Autorização do idealizador para manutenção em produção** (o acesso atual é só leitura):
   `VACUUM (ANALYZE) public.ad_metric_pack_map` — não trava a tabela.
2. Medir antes/depois: tempo da função e `Heap Fetches` no plano.
3. Se a ordenação em disco continuar, migration com `SET work_mem` na função (o mesmo padrão
   de `fetch_manager_performance_base_v155`) e medir de novo. **Só entra se o ganho aparecer**
   — na v157 esse ajuste foi testado e descartado por não mudar nada.
4. Avaliar autovacuum mais agressivo no mapa (`autovacuum_vacuum_scale_factor` na tabela).

**Não serve como atalho:** usar `ad_pack_inventory` para pré-filtrar. Medido: 28.125 dos
58.499 pares (pack, anúncio) do mapa **não** estão no inventário, que só cobre anúncio sem
entrega. É o mesmo tipo de pré-filtro inseguro que a migration 146 rejeitou.

**Pronto quando:** tempo medido antes e depois, com o ganho (ou a ausência dele) registrado.

---

## Bloco 5 — Grafo de conflito incremental (é o F2b)

**Por quê.** Mesmo afinado, o custo cresce com o volume e o grafo é refeito inteiro sempre que
qualquer pack muda. O F2b já tem estimativa: incremental por pack custa ~196 ms.

**Dependências e riscos (de `plano-eficiencia-carregamento.md`, §5):**
- **É decisão de segurança, não de performance:** alarga a janela de grafo velho, e este grafo
  é a ÚNICA proteção contra somar o mesmo anúncio duas vezes. Tem de falhar fechado.
- **Deve vir depois da feature de editar a data do pack** (outro chat): é a única ação capaz de
  criar sobreposição onde não havia, e ela precisa revalidar o grafo ao salvar.
- Guardar arestas + marca d'água por pack, tratando pack apagado, pack compartilhado e dois
  refreshes ao mesmo tempo. É a parte cara.
- A migration 145 prevê remover `ad_metric_pack_map` numa fase 2. O desenho definitivo deve
  nascer lendo a chave de `ad_metrics`, senão nasce para ser refeito.

**Passos**
1. Medir a frequência real: quantas vezes por dia o grafo muda (refresh por pack) contra
   quantas vezes é buscado. Sem isso não dá para dizer que o incremental compensa.
2. Desenhar (documento curto no próprio plano de eficiência, item F2b).
3. Implementar com teste e sabotagem: um conflito criado depois do último cálculo **tem** de
   aparecer; grafo indisponível **tem** de bloquear.

**Pronto quando:** medição, desenho aprovado e implementação com teste sabotado.

---

## Como retomar (para uma sessão sem histórico)

- **Banco de produção:** session pooler; credencial na memória `db_connection`. Só leitura sem
  autorização explícita; manutenção (VACUUM, migration) precisa do ok do idealizador.
- **Laboratório:** `hookify_lab` local, porta 5432, migrations 154/155/157 aplicadas. Testes SQL
  rodam SÓ lá (`supabase/tests/README.md`).
- **Deploy:** `ssh root@77.37.126.210`, `cd /var/www/hookify/deploy && ./deploy.sh` disparado com
  `setsid nohup`; esperar pela trava (`flock /tmp/hookify_deploy.lock true`), nunca por `pgrep`.
- **Ordem sugerida:** 1 → 2 → 3 → 4 → 5. Os blocos 1 a 4 são independentes entre si; o 5 espera
  a feature de editar data do pack.
