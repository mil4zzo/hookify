# Plano de Refatoração: UX de Atualização de Packs

## Objetivo

Refatorar completamente o fluxo de atualização de packs para:
1. Mostrar toast imediatamente após o usuário clicar (sensação de velocidade)
2. Permitir cancelamento antes do job_id ser recebido
3. Cancelar job em background quando job_id chegar após cancelamento
4. Substituir termos técnicos por mensagens amigáveis
5. Melhorar clareza das etapas de progresso
6. Garantir coerência entre feedback visual e processo real

## Contexto Técnico

### Arquivos Principais
- `frontend/components/layout/Topbar.tsx` - Atualização manual de packs
- `frontend/lib/hooks/useAutoRefreshPacks.ts` - Auto-refresh prompts
- `frontend/lib/utils/toast.tsx` - Sistema de notificações
- `backend/app/routes/analytics.py` - Jobs de Meta API
- `backend/app/routes/google_integration.py` - Jobs de Google Sheets
- `backend/app/services/job_processor.py` - Processamento de jobs Meta
- `backend/app/services/google_sheet_sync_job.py` - Processamento de Google Sheets

### Fluxo Atual (Meta Ads)
1. User clica "Atualizar dados"
2. Toast aparece: "Verificando... em X dia(s) - Inicializando..."
3. API `/refresh_pack` é chamada
4. API retorna `job_id` e `sync_job_id` (se houver integração Google)
5. Polling inicia com intervalo de 2s
6. Backend stages: `meta_running` → `processing` (paginação/enriquecimento/formatação) → `persisting` → `completed`
7. Frontend converte stages em progresso estimado em dias

### Fluxo Atual (Google Sheets Sync)
1. Job criado no endpoint `/refresh_pack` junto com o Meta job
2. Toast separado aparece: "Sincronizando planilha..."
3. Polling separado com intervalo de 2s
4. Backend stages: `processing` (lendo_planilha/processando_dados) → `persisting` → `completed`

### Problema Atual: Race Condition
```
User clica "Atualizar"
  → Toast aparece (job_id ainda é undefined)
    → User clica "Cancelar"
      → handleCancel tenta cancelar undefined
        → Toast fecha
          → API retorna job_id
            → updateProgressToast recria toast
              → Cancel button não funciona (stale closure)
                → Job continua executando
```

## Mudanças Propostas

### 1. Sistema de Cancelamento Robusto

#### 1.1 Adicionar Flag de "Pending Cancellation"
**Arquivo**: `Topbar.tsx`, `useAutoRefreshPacks.ts`

Criar sistema que rastreia cancelamento pendente:
```typescript
interface RefreshState {
  packId: string;
  packName: string;
  toastId: string;
  jobId?: string;          // Pode ser undefined inicialmente
  syncJobId?: string;      // Pode ser undefined
  cancelled: boolean;      // Flag de cancelamento
  pendingCancellation: boolean; // Novo: cancelamento antes de job_id
}
```

#### 1.2 Modificar handleCancel
**Localização**: `Topbar.tsx` linha ~603, `useAutoRefreshPacks.ts` linha ~244

```typescript
const handleCancel = async () => {
  console.log(`[TOPBAR] Usuário cancelou pack ${packId}`);
  cancelled = true;

  // Se já temos job_id, cancelar imediatamente
  if (refreshResult?.job_id) {
    try {
      await api.facebook.cancelJobsBatch(
        [refreshResult.job_id],
        "Cancelado pelo usuário"
      );
      console.log(`[TOPBAR] Job ${refreshResult.job_id} cancelado`);
    } catch (error) {
      console.error("Erro ao cancelar job:", error);
    }
  } else {
    // Marcar como "pending cancellation" - será cancelado quando job_id chegar
    console.log(`[TOPBAR] Marcando pack ${packId} para cancelamento pendente`);
    pendingCancellation = true;
  }

  // Sempre fechar toast e mostrar feedback imediato
  dismissToast(toastId);
  showWarning(`Atualização de "${packName}" cancelada`);
};
```

#### 1.3 Adicionar Verificação Pós-API
**Localização**: `Topbar.tsx` após linha ~639, `useAutoRefreshPacks.ts` após linha ~258

Após receber job_id da API, verificar se há cancelamento pendente:
```typescript
const response = await api.facebook.refreshPack(packId, today);
refreshResult = response.data;

// NOVO: Verificar se foi cancelado antes de receber job_id
if (cancelled && pendingCancellation && refreshResult.job_id) {
  console.log(`[TOPBAR] Executando cancelamento pendente para job ${refreshResult.job_id}`);
  try {
    await api.facebook.cancelJobsBatch(
      [refreshResult.job_id],
      "Cancelado pelo usuário (pendente)"
    );
    console.log(`[TOPBAR] Job ${refreshResult.job_id} cancelado em background`);
  } catch (error) {
    console.error("Erro ao cancelar job pendente:", error);
  }

  // Sair imediatamente do polling
  return;
}

// Adicionar job_id aos ativos
if (!addActiveJob(refreshResult.job_id)) {
  // Job já está sendo processado
  dismissToast(toastId);
  showWarning(`Atualização de "${packName}" já está em andamento`);
  return;
}
```

### 2. Melhorias nas Mensagens do Usuário

#### 2.1 Mapeamento de Termos Técnicos → User-Friendly

**Meta Ads Job**:
| Termo Técnico Atual | Novo Termo User-Friendly | Contexto |
|---------------------|--------------------------|----------|
| "Verificando..." | "Preparando atualização..." | Quando status = meta_running |
| "Inicializando..." | "Preparando atualização..." | Quando stage vazio |
| "paginação" | "Coletando anúncios..." | stage = STAGE_PAGINATION |
| "enriquecimento" | "Buscando detalhes..." | stage = STAGE_ENRICHMENT |
| "formatação" | "Processando dados..." | stage = STAGE_FORMATTING |
| "Salvando tudo..." | "Salvando..." | stage = STAGE_PERSISTENCE, sem detalhes |
| "Salvando anúncios: bloco X/Y..." | "Salvando anúncios..." | Durante upsert_ads |
| "Salvando métricas: bloco X/Y..." | "Salvando métricas..." | Durante upsert_ad_metrics |
| "Calculando resumo..." | "Calculando estatísticas..." | Durante calculate_pack_stats |
| "Otimizando tudo..." | "Finalizando..." | Durante update_pack_ad_ids |
| "Finalizando..." | "Concluindo..." | Último heartbeat |

**Google Sheets Sync**:
| Termo Técnico Atual | Novo Termo User-Friendly | Contexto |
|---------------------|--------------------------|----------|
| "Sincronizando planilha Google..." | "Importando planilha..." | Título do toast |
| "lendo_planilha" | "Lendo planilha..." | STAGE_READING |
| "processando_dados" | "Processando dados..." | STAGE_PROCESSING |
| "persistindo" | "Salvando dados..." | STAGE_PERSISTING |

#### 2.2 Implementar Traduções
**Arquivo**: `frontend/lib/utils/toast.tsx`

Criar função helper para traduzir stages:
```typescript
/**
 * Traduz stages técnicos do backend para mensagens amigáveis
 */
function getStageMessage(stage: string, details?: any): string {
  // Meta Ads stages
  if (stage === 'paginação' || stage === 'STAGE_PAGINATION') {
    return 'Coletando anúncios...';
  }
  if (stage === 'enriquecimento' || stage === 'STAGE_ENRICHMENT') {
    return 'Buscando detalhes...';
  }
  if (stage === 'formatação' || stage === 'STAGE_FORMATTING') {
    return 'Processando dados...';
  }
  if (stage === 'persistência' || stage === 'STAGE_PERSISTENCE') {
    // Checar detalhes específicos
    const msg = details?.message || '';
    if (msg.includes('Salvando anúncios')) return 'Salvando anúncios...';
    if (msg.includes('Salvando métricas')) return 'Salvando métricas...';
    if (msg.includes('Calculando resumo')) return 'Calculando estatísticas...';
    if (msg.includes('Otimizando')) return 'Finalizando...';
    if (msg.includes('Finalizando')) return 'Concluindo...';
    return 'Salvando...';
  }

  // Google Sheets stages
  if (stage === 'lendo_planilha') {
    return 'Lendo planilha...';
  }
  if (stage === 'processando_dados') {
    return 'Processando dados...';
  }
  if (stage.includes('persistindo')) {
    return 'Salvando dados...';
  }

  // Fallback
  return details?.message || 'Processando...';
}

/**
 * Traduz status do job para mensagem de progresso
 */
function getStatusMessage(status: string, stage?: string): string {
  if (status === 'meta_running') {
    return 'Preparando atualização...';
  }
  if (status === 'processing') {
    return stage ? getStageMessage(stage) : 'Processando...';
  }
  if (status === 'persisting') {
    return 'Salvando...';
  }
  if (status === 'completed') {
    return 'Concluído!';
  }
  if (status === 'failed') {
    return 'Erro ao atualizar';
  }
  if (status === 'cancelled') {
    return 'Cancelado';
  }

  return 'Processando...';
}
```

#### 2.3 Atualizar Chamadas de updateProgressToast
**Arquivos**: `Topbar.tsx`, `useAutoRefreshPacks.ts`

Modificar lógica de mapeamento de mensagens:
```typescript
// Linha ~666 em Topbar.tsx, ~282 em useAutoRefreshPacks.ts
let displayMessage: string;

if (progress.status === 'meta_running') {
  displayMessage = 'Preparando atualização...';
} else if (progress.status === 'processing') {
  const stage = progress.details?.stage || '';
  displayMessage = getStageMessage(stage, progress.details);
} else if (progress.status === 'persisting') {
  const stage = progress.details?.stage || '';
  displayMessage = getStageMessage(stage, progress.details);
} else {
  displayMessage = progress.message || 'Processando...';
}

updateProgressToast(
  toastId,
  packName,
  currentDay,
  totalDays,
  displayMessage,
  handleCancel
);
```

### 3. Melhorar Cálculo de Progresso em Dias

#### 3.1 Problema Atual
O progresso atual usa percentuais fixos por stage (30%, 60%, 85%, 95%, 100%) que são convertidos em dias. Isso causa:
- Saltos bruscos entre stages
- Dias não refletem progresso real
- "dia 0/1" → "dia 1/2" confuso para o usuário

#### 3.2 Nova Abordagem: Progresso Granular
**Arquivo**: `Topbar.tsx` linha ~648-660, `useAutoRefreshPacks.ts` linha ~270-282

```typescript
/**
 * Calcula progresso mais granular baseado em stage e detalhes
 */
function calculateProgress(status: string, details: any): number {
  if (status === 'completed') return 100;
  if (status === 'failed' || status === 'cancelled') return 0;

  const stage = details?.stage || '';

  // meta_running: 0-10%
  if (status === 'meta_running') {
    return 5;
  }

  // processing stages: 10-85%
  if (status === 'processing') {
    if (stage === 'paginação' || stage === 'STAGE_PAGINATION') {
      // 10-35%: usar page_count para progresso dentro do stage
      const pageCount = details?.page_count || 0;
      const estimatedPages = 10; // Estimar páginas típicas
      const pageProgress = Math.min(pageCount / estimatedPages, 1);
      return 10 + (pageProgress * 25);
    }
    if (stage === 'enriquecimento' || stage === 'STAGE_ENRICHMENT') {
      // 35-60%: usar enrichment_batches para progresso
      const batchNum = details?.enrichment_batches || 0;
      const totalBatches = details?.enrichment_total || 1;
      const enrichProgress = totalBatches > 0 ? batchNum / totalBatches : 0;
      return 35 + (enrichProgress * 25);
    }
    if (stage === 'formatação' || stage === 'STAGE_FORMATTING') {
      // 60-70%
      return 65;
    }
  }

  // persisting: 70-95%
  if (status === 'persisting') {
    const msg = details?.message || '';
    if (msg.includes('Salvando anúncios')) return 75;
    if (msg.includes('Salvando métricas')) return 82;
    if (msg.includes('Calculando')) return 88;
    if (msg.includes('Otimizando')) return 92;
    if (msg.includes('Finalizando')) return 95;
    return 70;
  }

  return 50; // Fallback
}

/**
 * Converte percentual em dias estimados
 */
function progressToDays(progressPercent: number, totalDays: number): number {
  // Arredondar para cima para não mostrar "dia 0"
  // Mostrar no mínimo dia 1
  const estimatedDay = Math.ceil((progressPercent / 100) * totalDays);
  return Math.max(1, Math.min(estimatedDay, totalDays));
}
```

Usar nas atualizações:
```typescript
const progressPercent = calculateProgress(progress.status, progress.details);
const currentDay = progressToDays(progressPercent, totalDays);

updateProgressToast(
  toastId,
  packName,
  currentDay,
  totalDays,
  displayMessage,
  handleCancel
);
```

### 4. Toast Imediato ao Clicar

#### 4.1 Mostrar Toast Antes da API
**Arquivo**: `Topbar.tsx` linha ~578-594

```typescript
const handleConfirmUpdate = async () => {
  setRefreshingPackId(packId);
  addUpdatingPack(packId);

  const packName = getPackName(packId);
  const totalDays = getTotalDays(packId);
  const toastId = `refresh-pack-${packId}`;

  // NOVO: Mostrar toast IMEDIATAMENTE
  showProgressToast(
    toastId,
    packName,
    1, // Começar no dia 1
    totalDays,
    'Preparando atualização...', // Mensagem inicial
    handleCancel // Cancel já habilitado
  );

  console.log(`[TOPBAR] Toast mostrado imediatamente para pack ${packId}`);

  let cancelled = false;
  let pendingCancellation = false;
  let refreshResult: any = null;

  // ... resto do código
```

### 5. Melhorar Feedback de Google Sheets Sync

#### 5.1 Mensagens Mais Claras
**Arquivo**: `Topbar.tsx` linha ~820-880, `useAutoRefreshPacks.ts` linha ~430-490

```typescript
// Toast inicial
showProgressToast(
  syncToastId,
  packName,
  1,
  2, // Google Sheets sync é tipicamente rápido (2 "dias" estimados)
  'Importando planilha...', // Novo: mais claro que "Sincronizando"
  handleCancelSync
);

// Durante polling
if (syncProgress.status === 'processing') {
  const stage = syncProgress.details?.stage || '';
  let message = 'Importando planilha...';

  if (stage === 'lendo_planilha') {
    message = 'Lendo planilha...';
  } else if (stage === 'processando_dados') {
    message = 'Processando dados...';
  }

  updateProgressToast(
    syncToastId,
    packName,
    1,
    2,
    message,
    handleCancelSync
  );
} else if (syncProgress.status === 'persisting') {
  updateProgressToast(
    syncToastId,
    packName,
    2,
    2,
    'Salvando dados...', // Novo: mais claro
    handleCancelSync
  );
}
```

#### 5.2 Mensagem de Sucesso Mais Informativa
**Arquivo**: `Topbar.tsx` linha ~940

```typescript
finishProgressToast(
  syncToastId,
  true,
  `Planilha importada com sucesso!` // Novo: mais claro que "sincronizada"
);
```

### 6. Pausa por Token Expirado - Melhorar UX

#### 6.1 Mensagem Mais Clara
**Arquivo**: `Topbar.tsx` linha ~860, `useAutoRefreshPacks.ts` linha ~460

Quando Google Sheets sync pausa por token expirado:
```typescript
if (syncProgress.error_code === "google_token_expired") {
  // Pausar job e salvar info
  pauseJob({
    syncJobId: syncJobId!,
    packId,
    packName,
    toastId: syncToastId,
    integrationId,
    pausedAt: new Date(),
    reason: "google_token_expired",
  });

  // Mostrar toast de pausa
  showPausedJobToast(
    syncToastId,
    packName,
    'Reconecte sua conta Google para continuar importando a planilha', // Novo: mais específico
    () => handleReconnect(integrationId)
  );
}
```

## Ordem de Implementação

### Fase 1: Sistema de Cancelamento Robusto (Crítico)
1. Adicionar flag `pendingCancellation` em `Topbar.tsx` e `useAutoRefreshPacks.ts`
2. Modificar `handleCancel` para suportar cancelamento pendente
3. Adicionar verificação pós-API para cancelar jobs pendentes
4. Testar cenários:
   - ✅ Cancelar após job_id recebido
   - ✅ Cancelar antes de job_id recebido
   - ✅ Verificar que job é cancelado em background

### Fase 2: Toast Imediato (Melhoria de Percepção)
1. Mover `showProgressToast` para ANTES da chamada da API
2. Garantir que cancel button funciona imediatamente
3. Testar que toast aparece instantaneamente ao clicar

### Fase 3: Mensagens User-Friendly (Alta Prioridade)
1. Criar funções `getStageMessage` e `getStatusMessage` em `toast.tsx`
2. Atualizar todos os pontos que chamam `updateProgressToast` para usar traduções
3. Testar que todas as mensagens estão amigáveis durante:
   - Meta ads job (todos os stages)
   - Google Sheets sync (todos os stages)
   - Casos de erro

### Fase 4: Progresso Granular (Melhoria de UX)
1. Implementar `calculateProgress` com lógica baseada em detalhes
2. Implementar `progressToDays` para conversão mais suave
3. Atualizar chamadas para usar novo cálculo
4. Testar que progresso avança suavemente sem saltos bruscos

### Fase 5: Melhorias em Google Sheets (Polimento)
1. Atualizar mensagens de Google Sheets sync
2. Melhorar feedback de token expirado
3. Testar fluxo completo de reconexão

## Testes Necessários

### Teste 1: Cancelamento Antes de job_id
**Passos**:
1. Clicar em "Atualizar dados"
2. Imediatamente clicar em "Cancelar" (antes de 200ms)
3. Verificar que toast fecha
4. Verificar que mensagem "Cancelado" aparece
5. Aguardar alguns segundos
6. Verificar que pack NÃO é atualizado
7. Verificar logs: job deve ser cancelado em background

### Teste 2: Cancelamento Após job_id
**Passos**:
1. Clicar em "Atualizar dados"
2. Aguardar ~1 segundo (job_id recebido)
3. Clicar em "Cancelar"
4. Verificar que toast fecha
5. Verificar que mensagem "Cancelado" aparece
6. Verificar que pack NÃO é atualizado

### Teste 3: Toast Imediato
**Passos**:
1. Clicar em "Atualizar dados"
2. Verificar que toast aparece INSTANTANEAMENTE (< 50ms)
3. Verificar que botão "Cancelar" está ativo desde o início

### Teste 4: Mensagens Amigáveis
**Passos**:
1. Clicar em "Atualizar dados"
2. Observar todas as mensagens durante o processo
3. Verificar que não há termos técnicos:
   - ❌ "paginação"
   - ❌ "enriquecimento"
   - ❌ "persistindo"
   - ❌ "Salvando tudo..."
   - ❌ "Otimizando tudo..."
4. Verificar que mensagens fazem sentido:
   - ✅ "Preparando atualização..."
   - ✅ "Coletando anúncios..."
   - ✅ "Buscando detalhes..."
   - ✅ "Processando dados..."
   - ✅ "Salvando..."
   - ✅ "Finalizando..."

### Teste 5: Progresso Suave
**Passos**:
1. Clicar em "Atualizar dados" em pack com muitos anúncios
2. Observar progresso em dias
3. Verificar que não há saltos bruscos:
   - ❌ "dia 0/5" → "dia 3/5"
   - ✅ "dia 1/5" → "dia 2/5" → "dia 3/5"

### Teste 6: Google Sheets Sync
**Passos**:
1. Atualizar pack com integração Google Sheets ativa
2. Verificar mensagens do segundo toast:
   - ✅ "Importando planilha..."
   - ✅ "Lendo planilha..."
   - ✅ "Processando dados..."
   - ✅ "Salvando dados..."
3. Verificar mensagem de sucesso: "Planilha importada com sucesso!"

### Teste 7: Token Expirado
**Passos**:
1. Expirar token do Google manualmente (backend)
2. Tentar atualizar pack
3. Verificar mensagem: "Reconecte sua conta Google para continuar importando a planilha"
4. Clicar em "Reconectar"
5. Verificar que fluxo OAuth funciona

## Arquivos a Modificar

### Alta Prioridade
1. ✅ `frontend/components/layout/Topbar.tsx` (linhas ~578-780)
2. ✅ `frontend/lib/hooks/useAutoRefreshPacks.ts` (linhas ~218-490)
3. ✅ `frontend/lib/utils/toast.tsx` (adicionar funções helper)

### Média Prioridade
4. `frontend/lib/store/activeJobs.ts` (manter logging atual)
5. `frontend/lib/store/pausedSheetJobs.ts` (sem mudanças necessárias)

### Baixa Prioridade (Backend - apenas se necessário)
6. `backend/app/services/job_processor.py` (mensagens já OK, podem melhorar)
7. `backend/app/services/google_sheet_sync_job.py` (mensagens já OK)

## Métricas de Sucesso

1. ✅ **Cancelamento funciona 100% das vezes** (antes e depois de job_id)
2. ✅ **Toast aparece em < 50ms** após clicar "Atualizar"
3. ✅ **Zero termos técnicos** nas mensagens mostradas ao usuário
4. ✅ **Progresso avança suavemente** sem saltos > 1 dia
5. ✅ **Mensagens fazem sentido** para usuário não-técnico
6. ✅ **Feedback de erro é claro** e acionável

## Notas de Implementação

### Compatibilidade com Backend
- Backend stages estão OK, não precisam mudar
- Frontend traduz stages para mensagens amigáveis
- Manter heartbeat messages detalhadas para debugging (logs)

### Performance
- Toast imediato não afeta performance da API
- Cancelamento pendente adiciona 1 request extra (aceitável)
- Progresso granular é calculado client-side (zero overhead no backend)

### Manutenibilidade
- Centralizar traduções em `toast.tsx`
- Usar constantes para stages (evitar strings mágicas)
- Documentar mapeamentos claramente

### Edge Cases
- Múltiplos cliques em "Atualizar": já tratado por `activeJobs` store
- Cancelar job já completado: toast já foi fechado, sem problema
- Perda de conexão durante polling: retry já implementado
- Job órfão no backend: será limpo automaticamente após timeout
