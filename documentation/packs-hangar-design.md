# Packs 2.0 — "Hangar": design travado

**Data:** 2026-07-07 · status: **design travado, implementação pendente** (aguardando commit da frente de status/enricher — `packs/page.tsx` e `PackCard.tsx` estão sujos no working tree)

## Visão

Transformar a página Packs de CRUD puro (grid de cards de gestão) num **hangar**: a superfície rica do filtro global de packs, onde o usuário **monta o esquadrão ativo** e vê o diagnóstico consolidado. Toque "gamer" que melhora a leitura sem virar gimmick.

## Decisões travadas

1. **Seleção do hangar = filtro global (`packPreferences`)**, sincronizada com Topbar//plano//manager. Um modelo de seleção só, duas superfícies (Topbar = atalho compacto; Packs = casa rica). Resolve a dissonância carrossel×multi-select: em vez de "carrossel que mostra 1", é "estante que destaca N" — click no card = entra/sai do esquadrão (multi-select nativo). Caso de uso que exige multi: usuários separam a mesma campanha em packs (teste vs escala; mesma campanha em contas distintas) e consolidam via multi-select.
2. **CRUD permanece na Packs** como ação secundária/contextual por card (refresh, auto-refresh, sheet, transcrição, remover) + "Carregar Pack".
3. **Princípio do toque gamer: gamificar a LEITURA, não a AÇÃO.** Linguagem visual de jogo que acelera percepção de estado (health bar, estados nomeados, match report) = funcional. Mecânicas de dopamina (XP, moedas, conquistas, confete ao agir) = proibidas (lição Robinhood; público inclui gestor profissional). Barra/anel SEMPRE acompanhado do número. Sem som. Animação em caminho crítico ≤300ms. Nunca celebrar volume (spend) — só eficiência vs alvo.
4. **Fases read-only-first**: (1) estante + cards de saúde; (2) transplante do bloco de diagnóstico do /plano (que fica só com o to-do list); (3) juice/streaks/match report narrativo.

## Layout (fase 2 completa; fase 1 = sem o painel de diagnóstico)

```
┌──────────────────────────────────────────────────────────┐
│  Esquadrão ativo:  [●El.30 Captação] [●El.30 Escala] +   │  ← chips dos selecionados
│  ┌────────────────────────────────────────────────────┐  │
│  │        DIAGNÓSTICO CONSOLIDADO DO ESQUADRÃO        │  │  ← fase 2: bloco vindo do /plano
│  │   headline CPR · driver cards · top movers         │  │    (usePackDiagnostic já é multi-pack)
│  └────────────────────────────────────────────────────┘  │
│  ─── estante de packs (scroll horizontal) ───            │
│  ┌─────┐ ┌─────┐ ╔═════╗ ╔═════╗ ┌─────┐                │
│  │pack │ │pack │ ║ATIVO ║ ║ATIVO ║ │pack │  →            │  ← click = toggle no esquadrão
│  └─────┘ └─────┘ ╚═════╝ ╚═════╝ └─────┘                │    ativos acendem/levantam
│  + Carregar Pack · CRUD contextual por card              │
└──────────────────────────────────────────────────────────┘
```

- **Click no card** = toggle in/out do esquadrão (escreve em `packPreferences` via `togglePack`). Atenção: `togglePack` hoje guarda invariante ≥1 — comportamento já revisado (0 packs é válido via outras rotas; ver memória `pack_filter_zero_selection_valid`).
- **Hover/focus** = peek (tooltip rico com mini-resumo do pack individual), sem mudar seleção.
- Ações de CRUD movem para menu contextual (⋯) no card — click primário vira seleção (hoje o card não tem click primário, os botões são explícitos; preservar acessos).

## Anatomia do pack card (fase 1)

Character card com: nome + conta de origem (já existe), **health ring com número** (ex.: CPR do range vs custo-alvo do action type; fallback: % de ads com CPR ≤ média global), **estado nomeado** (🔥 Escalando / ⚖️ Estável / 🩸 Sangrando / ⏸ Sem entrega — derivado de ΔCPR e delivery), spend do período, Δ vs alvo, badge auto-refresh/sheet, borda/glow por estado (tokens semânticos: success/attention/destructive com opacidade-hífen).

### Fonte de dados da saúde (fase 1, sem backend novo)

**Uma** query `ad-performance` com `pack_ids` = todos os packs (mesma RPC das outras páginas) + split client-side por pack via `packsAdsMap`/`getPackId` (mecanismo já existente no pipeline). Por pack: Σspend, Σresults(actionType), CPR = razão das somas (média ponderada — princípio "só existe uma média"). Comparação vs `targetCprByActionType` (preferência já persistida). **Sem série por dia na fase 1** (streaks/sparklines = fase 3, exigem series — avaliar RPC leve agregada por pack na ocasião).

## Fase 2 — transplante do diagnóstico

Mover do /plano: `DayComparisonBlock` (+ `PackDiagnosticPanel` colapsável, resolvendo o toggle que hoje mora no PlanHero). /plano fica: hero + to-do list. Motor intocado (`usePackDiagnostic` já recebe `selectedPackIds`). Links cruzados: card de ação no /plano → "por quê? ver diagnóstico" (Packs); diagnóstico → "ver plano de ação".

## Fase 3 — juice

Entrada com stagger, números contando, tilt sutil no hover, glow por estado; streak de eficiência ("N dias abaixo do alvo") no card; match report narrativo no consolidado ("O dia: CPR ↑20%, culpa do CPM. MVP: ad X"). Semente futura (não escopo): /plano como quest log — única gamificação de ação aceitável, pois o "loot" é economia real.

## Anti-padrões (lembrete)

XP/moedas/conquistas/login-streak; celebrar spend; som; barra sem número; animação bloqueante; esconder número atrás de metáfora.
