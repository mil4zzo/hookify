import { translate } from "./translate";

/**
 * Mensagens de erro do backend (em português) que o usuário vê e que ganham tradução.
 *
 * O backend manda `detail` como texto, e há centenas de pontos; trocar tudo por códigos
 * de erro seria uma reescrita de contrato. Este atalho cobre as mensagens estáticas
 * mais comuns (não encontrado, nome vazio, sem permissão...). O que não está na lista
 * aparece como o backend mandou. Mensagens com valores dentro (f-string) não entram.
 *
 * shortcut: casamento por texto, migrar para códigos de erro se a lista passar de ~100
 * mensagens ou se o backend reescrever os textos. O teste confere que cada texto da lista
 * ainda existe no código do backend.
 */
export const BACKEND_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ["Pack não encontrado", "packNotFound"],
  ["Job não encontrado", "jobNotFound"],
  ["Integração não encontrada", "integrationNotFound"],
  ["Integrações não encontradas", "integrationsNotFound"],
  ["Nenhuma integração informada", "noIntegrationGiven"],
  ["Compartilhamento não encontrado", "shareNotFound"],
  ["Share não encontrado", "shareNotFound"],
  ["Link não encontrado", "linkNotFound"],
  ["Board não encontrado", "boardNotFound"],
  ["Grupo não encontrado", "groupNotFound"],
  ["Grupo não encontrado neste board", "groupNotInBoard"],
  ["Tag não encontrada", "tagNotFound"],
  ["Pasta não encontrada", "folderNotFound"],
  ["Conexão não encontrada", "connectionNotFound"],
  ["Coluna vinculada não encontrada", "linkedColumnNotFound"],
  ["Usuário convidado não encontrado", "invitedUserNotFound"],
  ["Você não pode compartilhar um pack consigo mesmo", "cannotSharePackWithSelf"],
  ["Você não pode compartilhar uma pasta consigo mesmo", "cannotShareFolderWithSelf"],
  ["Você não tem acesso compartilhado a este pack", "noSharedAccess"],
  ["Nada para atualizar", "nothingToUpdate"],
  ["Nome não pode ser vazio", "nameEmpty"],
  ["Nome do pack não pode ser vazio", "packNameEmpty"],
  ["Nome da pasta não pode ser vazio", "folderNameEmpty"],
  ["Nome da tag não pode ser vazio", "tagNameEmpty"],
  ["Pack não tem adaccount_id configurado", "packNoAdAccount"],
  ["Conexão não está ativa. Use reconectar para renovar o token.", "connectionInactive"],
  ["Token não disponível. Reconecte a conta do Facebook.", "tokenUnavailable"],
  ["Só o dono do pack, ou quem edita a pasta onde ele está, pode editar o período.", "periodEditForbidden"],
  ["Não foi possível alterar o período. O pack continua como estava.", "periodChangeFailed"],
  ["Transcrição já está em andamento para este anúncio", "transcriptionRunning"],
  ["Job de transcrição não encontrado.", "transcriptionJobNotFound"],
  ["Erro ao iniciar transcrição", "transcriptionStartFailed"],
  ["Erro ao obter status de transcrição", "transcriptionStatusFailed"],
  ["Erro ao buscar dados do anúncio", "adDataFailed"],
  ["Erro ao consultar analytics agregados.", "analyticsFailed"],
  ["Erro ao listar conexões Google", "googleListFailed"],
  ["Erro ao deletar conexão Google", "googleDeleteFailed"],
  ["Erro ao salvar configuração.", "saveSettingFailed"],
  ["Erro ao salvar configurações iniciais", "saveInitialFailed"],
  ["Erro ao verificar a integração.", "verifyIntegrationFailed"],
  ["Erro ao deletar integração", "deleteIntegrationFailed"],
  ["É obrigatório selecionar a coluna de Leadscore.", "leadscoreColumnRequired"],
  ["Só uma coluna do tipo leadscore tem corte de MQL.", "mqlCutOnlyLeadscore"],
  ["Esta integração não está vinculada a um pack, então não há o que limpar com segurança.", "integrationNoPack"],
  ["Não foi possível apagar o leadscore importado, então a planilha não foi desconectada. Tente de novo.", "leadscoreClearFailed"],
  ["Nenhum pack informado", "nonePackGiven"],
  ["Selecione ao menos um pack.", "selectOnePack"],
  ["Datas inválidas. Use formato YYYY-MM-DD.", "invalidDates"],
  ["Formato de data inválido. Use 'DD/MM/YYYY' ou 'MM/DD/YYYY'.", "invalidDateFormat"],
  ["date_start não pode ser depois de date_stop", "dateStartAfterStop"],
  ["Forneça transcription_id ou ad_name", "transcriptionIdOrName"],
  ["Forneça apenas transcription_id ou ad_name, não ambos", "transcriptionIdOrNameNotBoth"],
  ["ad_name é obrigatório", "adNameRequired"],
  ["Anúncio não possui primary_video_id e/ou creative.actor_id", "adNoVideo"],
  ["Endpoint legado descontinuado. Utilize o fluxo assíncrono de sync-job.", "legacyEndpoint"],
  ["Nenhum campo válido enviado", "noValidField"],
  ["items é obrigatório (lista não-vazia)", "itemsRequired"],
  ["ad_name inválido em um dos itens", "itemAdNameInvalid"],
  ["Facebook não retornou URL da foto de perfil", "noProfilePhoto"],
  ["Resposta do Google não contém access_token.", "googleNoAccessToken"],
  ["Google OAuth não configurado. Falta GOOGLE_OAUTH_CLIENT_ID.", "googleOAuthNotConfigured"],
];

/**
 * Mensagens com valor dentro (f-string do backend): `{nome}` é o pedaço que varia e vai
 * para a tradução. `field`, `id`, `n`, `got` são uma palavra só; o resto é texto livre.
 */
export const BACKEND_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  ["Transcrição não encontrada para id={id}", "transcriptionNotFoundId"],
  ["Transcrição não encontrada para ad_name={name}", "transcriptionNotFoundName"],
  ["Ad name '{name}' não encontrado no período especificado", "adNameNotInPeriod"],
  ["Adset ID {id} não encontrado no período especificado", "adsetNotInPeriod"],
  ["Ad ID {id} não encontrado no período especificado", "adIdNotInPeriod"],
  ["Pack {id} não encontrado", "packIdNotFound"],
  ["Nenhum anúncio encontrado para ad_name={name}", "noAdForName"],
  ["Já existe um pack com o nome '{name}'", "packNameExists"],
  ["No máximo {n} packs por vez.", "maxPacksAtOnce"],
  ["No máximo {n} integrações por vez.", "maxIntegrationsAtOnce"],
  ["Máximo de {n} criativos por link", "maxCreativesPerLink"],
  ["Maximo de {n} ad_names por request (recebido: {got})", "maxAdNamesPerRequest"],
  ["Nome da pasta passa de {n} caracteres.", "folderNameTooLong"],
  ["{field} inválido (esperado YYYY-MM-DD)", "fieldInvalidDate"],
  ["{field} invalido: {value}", "fieldInvalidValue"],
  ["{field} invalido", "fieldInvalid"],
  ["pack_id invalido: {value}", "packIdInvalid"],
  ["target_cpr['{type}'] deve ser > 0 (remova a chave para limpar)", "targetCprPositive"],
  ["Coluna '{label}': índice inválido.", "columnIndexInvalid"],
  ["Coluna '{label}': o tipo não pode mudar depois de criado. Exclua o vínculo e crie outro.", "columnTypeLocked"],
  ["Coluna '{label}': a coluna da planilha não pode mudar depois de criada. Exclua o vínculo e crie outro.", "columnSheetLocked"],
  ["Coluna '{label}': é a coluna de {reserved}; escolha outra.", "columnReserved"],
  ["Colunas '{a}' e '{b}' apontam para a mesma coluna da planilha.", "columnsSameIndex"],
  ["Criativo duplicado: {name}", "duplicateCreative"],
  ["Criativos não encontrados na sua conta: {names}", "creativesNotFound"],
  ["Erro ao listar packs: {detail}", "err_listPacks"],
  ["Erro ao buscar pack: {detail}", "err_getPack"],
  ["Erro ao buscar thumbnail cache: {detail}", "err_thumbCache"],
  ["Erro ao deletar pack: {detail}", "err_deletePack"],
  ["Erro ao atualizar auto_refresh: {detail}", "err_autoRefresh"],
  ["Erro ao atualizar julgamento: {detail}", "err_judgment"],
  ["Erro ao calcular a prévia: {detail}", "err_preview"],
  ["Erro ao atualizar nome: {detail}", "err_rename"],
  ["Erro ao obter progresso: {detail}", "err_progress"],
  ["Erro ao iniciar sincronização: {detail}", "err_startSync"],
  ["Erro ao conectar com Google: {detail}", "err_googleConnect"],
  ["Erro no token endpoint do Google: {code}", "err_googleToken"],
  ["Falha ao gerar token único: {detail}", "err_uniqueToken"],
  ["Falha ao dispensar o aviso: {detail}", "err_dismiss"],
];

// Caracteres que o Windows-1252 põe nas posições 0x80–0x9F (é onde o acento quebrado cai).
const CP1252_BYTES: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Desfaz uma camada de UTF-8 lido como Windows-1252 ("nÃ£o" -> "não"); null se o texto não é isso. */
function undoMojibake(text: string): string | null {
  const bytes: number[] = [];
  for (const char of text) {
    const code = CP1252_BYTES[char] ?? char.charCodeAt(0);
    if (code > 255) return null;
    bytes.push(code);
  }
  const fixed = new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
  return fixed.includes("�") ? null : fixed;
}

/** Desfaz o acento quebrado e nada mais (a caixa e o espaço ficam como vieram). */
function repair(message: string): string {
  let text = message;
  for (let i = 0; i < 2 && /[ÃÂ]/.test(text); i++) {
    const fixed = undoMojibake(text);
    if (!fixed) break;
    text = fixed;
  }
  return text;
}

/** Sem acento e em minúsculas, do MESMO tamanho: a posição de um trecho vale nos dois textos. */
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Texto comparável: conserta acento quebrado (`nÃ£o`), tira acento, caixa e ponto final. */
export function normalizeBackendMessage(message: string): string {
  return fold(repair(message))
    .replace(/[.!\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SINGLE_WORD = new Set(["field", "id", "n", "got"]);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type CompiledPattern = { regex: RegExp; names: string[]; key: string };

/** Cada trecho fixo vira um grupo também: somando os tamanhos dos grupos acha-se onde cada valor começa. */
function compilePattern(template: string, key: string): CompiledPattern {
  const names: string[] = [];
  const source = template
    .split(/\{(\w+)\}/)
    .map((part, i) => {
      if (i % 2 === 0) return `(${escapeRegex(fold(part))})`;
      names.push(part);
      return SINGLE_WORD.has(part) ? "(\\S+)" : "(.+?)";
    })
    .join("");
  return { regex: new RegExp(`^${source}[.!\\s]*$`), names, key };
}

const KEY_BY_TEXT = new Map(BACKEND_MESSAGES.map(([text, key]) => [normalizeBackendMessage(text), key]));
const COMPILED_PATTERNS = BACKEND_PATTERNS.map(([template, key]) => compilePattern(template, key));

function translatePattern(message: string): string | null {
  const fixed = repair(message);
  const folded = fold(fixed);
  for (const { regex, names, key } of COMPILED_PATTERNS) {
    const match = regex.exec(folded);
    if (!match) continue;
    const values: Record<string, string> = {};
    let offset = 0;
    match.slice(1).forEach((group, i) => {
      if (i % 2 === 1) values[names[(i - 1) / 2]] = fixed.slice(offset, offset + group.length);
      offset += group.length;
    });
    return translate(`backendErrors.${key}`, values);
  }
  return null;
}

/** Devolve a mensagem no idioma do app quando a conhecemos; senão, a original. */
export function translateBackendMessage(message: string): string {
  const key = KEY_BY_TEXT.get(normalizeBackendMessage(message));
  return key ? translate(`backendErrors.${key}`) : translatePattern(message) ?? message;
}
