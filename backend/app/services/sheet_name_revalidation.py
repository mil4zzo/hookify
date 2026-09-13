"""Reconfere no Drive o nome das planilhas vinculadas — fora do sync.

POR QUE ISTO EXISTE
-------------------
`ad_sheet_integrations.spreadsheet_name` e texto persistido: nenhuma tela le o
nome do Google. Ate aqui ele so era reconferido dentro do sync
(`_refresh_spreadsheet_name`), o que deixava um buraco simples de enunciar: pack
que parou de sincronizar exibe para sempre o nome do ultimo sync.

O buraco nao e cosmetico. O arquivo do Drive costuma ser UM SO, renomeado a cada
lancamento com o conteudo substituido — entao o vinculo antigo nao aponta para
uma planilha morta, aponta para o arquivo VIVO do lancamento atual. Ver a
migration 147 para o levantamento que mostrou isso.

O QUE TORNA ISTO BARATO
-----------------------
A deduplicacao por (conexao, spreadsheet_id). Como o mesmo arquivo serve dezenas
de packs, revalidar 25 vinculos custa 1 chamada ao Drive, nao 25. Sem o dedupe
esta rota seria cara demais para viver num read-path e a ideia inteira cairia.

BEST-EFFORT DE PONTA A PONTA
----------------------------
Nada aqui pode subir excecao. Isto roda em segundo plano, sem o usuario ter
pedido: uma falha do Drive tem que terminar em "mantem o nome guardado e
ninguem fica sabendo". Em especial o 401 — `get_spreadsheet_name` levanta
GOOGLE_TOKEN_EXPIRED, e deixar esse codigo chegar ao front dispara o evento
global `google-token-expired`, ou seja, o app pediria "reconecte sua conta
Google" sozinho, no meio de uma navegacao qualquer.

ESCOPO: SO O QUE O CHAMADOR E DONO
----------------------------------
Packs compartilhados ficam de fora de proposito. A credencial do Google e do
DONO (o convidado nao tem conexao para consultar o Drive), e gastar a cota do
dono porque um convidado abriu uma tela seria cobrar de quem nao pediu. O nome
do pack compartilhado se acerta quando o dono carrega a lista dele.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from app.core.supabase_client import get_supabase_for_user
from app.services.google_sheets_service import get_spreadsheet_name

logger = logging.getLogger(__name__)


def _load_own_integrations(sb, user_id: str) -> List[Dict[str, Any]]:
    try:
        res = (
            sb.table("ad_sheet_integrations")
            .select("id, pack_id, spreadsheet_id, spreadsheet_name, spreadsheet_renamed_from, connection_id")
            .eq("owner_id", user_id)
            .execute()
        )
        return [r for r in (res.data or []) if isinstance(r, dict)]
    except Exception as e:
        logger.warning("[SHEET_NAME_REVALIDATE] Falha ao ler integracoes de %s: %s", user_id, e)
        return []


def _resolve_names(
    user_jwt: str,
    user_id: str,
    integrations: List[Dict[str, Any]],
) -> Dict[Tuple[Optional[str], str], Optional[str]]:
    """Uma chamada ao Drive por (conexao, arquivo) distinto. Falha vira None."""
    chaves: List[Tuple[Optional[str], str]] = []
    for integ in integrations:
        sid = integ.get("spreadsheet_id")
        if not isinstance(sid, str) or not sid:
            continue
        cid = integ.get("connection_id")
        chave = (cid if isinstance(cid, str) else None, sid)
        if chave not in chaves:
            chaves.append(chave)

    nomes: Dict[Tuple[Optional[str], str], Optional[str]] = {}
    for connection_id, spreadsheet_id in chaves:
        try:
            nomes[(connection_id, spreadsheet_id)] = get_spreadsheet_name(
                user_jwt=user_jwt,
                user_id=user_id,
                spreadsheet_id=spreadsheet_id,
                connection_id=connection_id,
            )
        except Exception as e:
            # Inclui GOOGLE_TOKEN_EXPIRED de proposito: ver docstring do modulo.
            logger.info(
                "[SHEET_NAME_REVALIDATE] Nao foi possivel conferir o nome de %s: %s",
                spreadsheet_id, e,
            )
            nomes[(connection_id, spreadsheet_id)] = None
    return nomes


def revalidate_sheet_names(user_jwt: str, user_id: str) -> List[Dict[str, Any]]:
    """Reconfere e persiste os nomes. Devolve SO os vinculos que mudaram.

    Devolver apenas o que mudou nao e economia de bytes: e o que permite a tela
    aplicar um patch cirurgico em vez de repintar a lista inteira de packs a
    cada carregamento.
    """
    if not user_id:
        return []

    try:
        sb = get_supabase_for_user(user_jwt)
    except Exception as e:
        logger.warning("[SHEET_NAME_REVALIDATE] Sem cliente Supabase: %s", e)
        return []

    integrations = _load_own_integrations(sb, user_id)
    if not integrations:
        return []

    nomes = _resolve_names(user_jwt, user_id, integrations)
    alterados: List[Dict[str, Any]] = []

    for integ in integrations:
        spreadsheet_id = integ.get("spreadsheet_id")
        if not isinstance(spreadsheet_id, str) or not spreadsheet_id:
            continue
        cid = integ.get("connection_id")
        atual = nomes.get((cid if isinstance(cid, str) else None, spreadsheet_id))

        # None = Drive fora do ar, sem acesso ou 404. O nome guardado segue sendo
        # a melhor informacao que temos; sobrescrever com vazio seria uma piora.
        if not atual:
            continue

        guardado = integ.get("spreadsheet_name")
        guardado = guardado.strip() if isinstance(guardado, str) else ""
        if atual == guardado:
            continue

        payload: Dict[str, Any] = {"spreadsheet_name": atual}
        # 148: a marca guarda sempre o nome imediatamente ANTERIOR. O aviso
        # responde "o que mudou desde a ultima vez que olhei?" — num arquivo
        # renomeado a cada lancamento, o nome de nascimento vira trivia.
        # Preencher um nome que faltava nao e renomeacao: nao ha "antes era X".
        renomeado_de = None
        if guardado:
            payload["spreadsheet_renamed_from"] = guardado
            renomeado_de = guardado

        try:
            (
                sb.table("ad_sheet_integrations")
                .update(payload)
                .eq("id", integ["id"])
                .eq("owner_id", user_id)
                .execute()
            )
        except Exception as e:
            logger.warning(
                "[SHEET_NAME_REVALIDATE] Falha ao gravar nome de %s: %s", integ.get("id"), e
            )
            continue

        logger.info(
            "[SHEET_NAME_REVALIDATE] Planilha renomeada: '%s' -> '%s' (integracao %s)",
            guardado or "(vazio)", atual, integ.get("id"),
        )
        alterados.append({
            "integration_id": str(integ["id"]),
            "pack_id": str(integ["pack_id"]) if integ.get("pack_id") else None,
            "spreadsheet_name": atual,
            "spreadsheet_renamed_from": renomeado_de,
        })

    return alterados
