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

/** Texto comparável: conserta acento quebrado (`nÃ£o`), tira acento, caixa e ponto final. */
export function normalizeBackendMessage(message: string): string {
  let text = message;
  for (let i = 0; i < 2 && /[ÃÂ]/.test(text); i++) {
    const fixed = undoMojibake(text);
    if (!fixed) break;
    text = fixed;
  }
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.!\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const KEY_BY_TEXT = new Map(BACKEND_MESSAGES.map(([text, key]) => [normalizeBackendMessage(text), key]));

/** Devolve a mensagem no idioma do app quando a conhecemos; senão, a original. */
export function translateBackendMessage(message: string): string {
  const key = KEY_BY_TEXT.get(normalizeBackendMessage(message));
  return key ? translate(`backendErrors.${key}`) : message;
}
