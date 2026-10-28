"""Pasta compartilhada (migration 181): o que a pasta cobre e o que mudou de acesso.

A AUTORIZACAO nao mora aqui. Quem concede e retira acesso sao os gatilhos do banco
(`sync_folder_pack_grants`), que materializam a pasta em `pack_shares` com
`source_folder_id`. Este modulo faz duas coisas ao redor disso:

  1. dizer ao dono, ANTES, o que uma pasta cobre (subarvore, packs que ela repassa e
     packs de terceiros que ficam de fora);
  2. dizer, DEPOIS de um gesto, quanto acesso mudou — e registrar no feed do pack.
     O gatilho nao sabe falar com o log; o feed e o unico lugar que explica como um
     nome novo apareceu agindo num pack (P3.5).

A arvore e sempre a do DONO da pasta: o editor mexe nela pelas RPCs da 181, entao
"os packs debaixo desta pasta" e lido na arvore do dono (service role), nao na do ator.

Tudo aqui e leitura. Nenhuma funcao concede ou revoga.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

from app.core.supabase_client import get_supabase_service
from app.core.supabase_retry import with_postgrest_retry
from app.services import pack_action_log

logger = logging.getLogger(__name__)

# PostgREST monta o .in_() na URL: mesmo teto usado no resto do projeto.
ID_BATCH = 200


# ── Funcoes puras sobre a arvore ────────────────────────────────────────────

def subtree_folder_ids(folders: Sequence[Dict[str, Any]], root_id: str) -> List[str]:
    """A pasta e todas as descendentes (a propria primeiro). Defensivo contra ciclo."""
    children: Dict[str, List[str]] = {}
    for f in folders:
        parent = f.get("parent_id")
        if parent:
            children.setdefault(str(parent), []).append(str(f["id"]))
    out: List[str] = []
    seen = set()
    stack = [str(root_id)]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        out.append(current)
        stack.extend(children.get(current, []))
    return out


def ancestor_ids(folders: Sequence[Dict[str, Any]], folder_id: str) -> List[str]:
    """Pastas acima de `folder_id`, da mais proxima ate a raiz (sem a propria)."""
    parent_of = {str(f["id"]): (str(f["parent_id"]) if f.get("parent_id") else None) for f in folders}
    out: List[str] = []
    seen = {str(folder_id)}
    current = parent_of.get(str(folder_id))
    while current and current not in seen:
        out.append(current)
        seen.add(current)
        current = parent_of.get(current)
    return out


def pack_ids_in_folders(members: Dict[str, str], folder_ids: Sequence[str]) -> List[str]:
    """Packs que moram em alguma das pastas. `members` = {pack_id: folder_id}."""
    wanted = set(str(f) for f in folder_ids)
    return [pack_id for pack_id, folder_id in members.items() if folder_id in wanted]


# ── Leitura ─────────────────────────────────────────────────────────────────

def load_tree(sb, actor_id: str) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Pastas do ator + {pack_id: folder_id}. Cliente do usuario: a RLS ja filtra."""
    folders = with_postgrest_retry(
        "folder_scope.folders",
        lambda: sb.table("folders").select("id, name, parent_id").eq("user_id", actor_id).execute(),
    ).data or []
    rows = with_postgrest_retry(
        "folder_scope.members",
        lambda: sb.table("pack_folder_members").select("pack_id, folder_id").eq("user_id", actor_id).execute(),
    ).data or []
    members = {str(r["pack_id"]): str(r["folder_id"]) for r in rows if r.get("pack_id") and r.get("folder_id")}
    return folders, members


def tree_of_folder(folder_id: str) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """A arvore inteira (do DONO) onde a pasta mora. Service role: o editor de uma pasta
    alheia nao le as linhas do dono pela RLS. So sai da rota como lista de pack_ids."""
    sb = get_supabase_service()
    rows = with_postgrest_retry(
        "folder_scope.folder_owner",
        lambda: sb.table("folders").select("user_id").eq("id", folder_id).limit(1).execute(),
    ).data or []
    if not rows:
        return [], {}
    return load_tree(sb, str(rows[0]["user_id"]))


def subtree_pack_ids(folder_id: str) -> List[str]:
    """Packs da pasta e de todas as subpastas, na arvore do dono."""
    folders, members = tree_of_folder(folder_id)
    return pack_ids_in_folders(members, subtree_folder_ids(folders, folder_id))


def contributed_pack_ids(sb, actor_id: str, pack_ids: Sequence[str]) -> List[str]:
    """Dos packs pedidos, os que o PROPRIO dono pos na arvore do ator (ex.: o editor
    criou o pack dele dentro da pasta). A pasta os repassa como se fossem do ator."""
    wanted = set(str(p) for p in pack_ids)
    if not wanted:
        return []
    rows = with_postgrest_retry(
        "folder_scope.contributed",
        lambda: sb.table("pack_folder_members").select("pack_id").eq("user_id", actor_id).eq("contributed", True).execute(),
    ).data or []
    return [str(r["pack_id"]) for r in rows if str(r.get("pack_id")) in wanted]


def owned_pack_ids(sb, actor_id: str, pack_ids: Sequence[str]) -> List[str]:
    """Dos packs pedidos, os que sao DO ator. O resto e pack alheio arquivado na
    pasta dele (convidado organizando a propria tela): a pasta nao concede sobre ele."""
    out: List[str] = []
    ids = list(pack_ids)
    for i in range(0, len(ids), ID_BATCH):
        chunk = ids[i : i + ID_BATCH]
        rows = with_postgrest_retry(
            "folder_scope.owned",
            lambda chunk=chunk: sb.table("packs").select("id").eq("user_id", actor_id).in_("id", chunk).execute(),
        ).data or []
        out.extend(str(r["id"]) for r in rows)
    return out


def actor_has_folder_shares(sb) -> bool:
    """Atalho: quem nunca compartilhou pasta (nem recebeu uma) nao paga o antes/depois
    de cada mover. A RLS devolve as linhas em que o ator e dono OU convidado."""
    rows = with_postgrest_retry(
        "folder_scope.has_shares",
        lambda: sb.table("folder_shares").select("id").limit(1).execute(),
    ).data or []
    return bool(rows)


Snapshot = Dict[Tuple[str, str], Dict[str, Optional[str]]]


def derived_snapshot(pack_ids: Sequence[str]) -> Snapshot:
    """{(pack_id, grantee_id): {role, folder_id, owner_id}} do acesso que vem de pasta.

    Service role: a leitura e do dono, mas a tabela e pequena e o filtro por
    `pack_id` ja e o escopo — nada daqui sai da rota alem de contagens.
    """
    out: Snapshot = {}
    ids = list(pack_ids)
    if not ids:
        return out
    sb = get_supabase_service()
    for i in range(0, len(ids), ID_BATCH):
        chunk = ids[i : i + ID_BATCH]
        rows = with_postgrest_retry(
            "folder_scope.snapshot",
            lambda chunk=chunk: sb.table("pack_shares")
            .select("pack_id, owner_id, grantee_id, role, source_folder_id")
            .in_("pack_id", chunk)
            .not_.is_("source_folder_id", "null")
            .execute(),
        ).data or []
        for r in rows:
            out[(str(r["pack_id"]), str(r["grantee_id"]))] = {
                "role": r.get("role"),
                "folder_id": str(r["source_folder_id"]) if r.get("source_folder_id") else None,
                "owner_id": str(r["owner_id"]) if r.get("owner_id") else None,
            }
    return out


# ── Antes / depois ──────────────────────────────────────────────────────────

DiffKey = Tuple[str, str, Optional[str]]


def diff_snapshots(before: Snapshot, after: Snapshot) -> Dict[str, Dict[DiffKey, List[str]]]:
    """O que mudou entre duas fotos. Chaves: (grantee_id, papel, dono do pack) -> packs.

    O dono entra na chave porque um gesto numa pasta compartilhada pode mexer em packs
    de donos diferentes (o pack que o editor pos la e dele), e cada linha do feed e
    gravada no silo de um dono.
    """
    granted: Dict[DiffKey, List[str]] = {}
    revoked: Dict[DiffKey, List[str]] = {}
    changed: Dict[DiffKey, List[str]] = {}
    for (pack_id, grantee_id), now in after.items():
        prev = before.get((pack_id, grantee_id))
        if prev is None:
            granted.setdefault((grantee_id, str(now.get("role")), now.get("owner_id")), []).append(pack_id)
        elif prev.get("role") != now.get("role"):
            changed.setdefault((grantee_id, str(now.get("role")), now.get("owner_id")), []).append(pack_id)
    for (pack_id, grantee_id), prev in before.items():
        if (pack_id, grantee_id) not in after:
            revoked.setdefault((grantee_id, str(prev.get("role")), prev.get("owner_id")), []).append(pack_id)
    return {"granted": granted, "revoked": revoked, "changed": changed}


def _count(group: Dict[DiffKey, List[str]]) -> int:
    return sum(len(v) for v in group.values())


def log_access_changes(actor_id: str, diff: Dict[str, Any]) -> None:
    """Uma linha por (pessoa, papel) no feed dos packs afetados. Nunca levanta.

    `via_folder` (e nao o NOME da pasta): o feed do pack e lido tambem pelo
    convidado, e o nome da pasta e organizacao pessoal do dono.
    """
    plan = (
        (pack_action_log.ACTION_SHARE_GRANT, diff["granted"]),
        (pack_action_log.ACTION_SHARE_REVOKE, diff["revoked"]),
        (pack_action_log.ACTION_SHARE_ROLE, diff["changed"]),
    )
    for action, group in plan:
        for (grantee_id, role, owner_id), packs in group.items():
            owner = owner_id or actor_id
            pack_action_log.log_pack_action(
                action=action,
                # O editor da pasta tambem muda acesso (move um pack, desfaz subpasta):
                # o papel registrado e o dele no pack, nao "dono" por padrao.
                actor_id=actor_id, actor_role="dono" if owner == actor_id else "editor", owner_id=owner,
                pack_ids=packs,
                target_type="share", target_ids=[grantee_id],
                detail={"role": role, "via_folder": True},
            )


@contextmanager
def tracked_access_changes(sb, actor_id: str, pack_ids: Sequence[str]) -> Iterator[Dict[str, int]]:
    """Fotografa o acesso por pasta dos packs, deixa o gesto acontecer e compara.

    Cede um dict `{granted, revoked, changed}` (contagens de pares pack x pessoa)
    que fica preenchido ao sair do bloco — a rota o devolve para a tela dizer
    "agora visivel para N pessoas". Quem nunca compartilhou pasta paga UMA leitura
    (o atalho) e nada mais.
    """
    result = {"granted": 0, "revoked": 0, "changed": 0}
    ids = [str(p) for p in dict.fromkeys(pack_ids or [])]
    try:
        active = bool(ids) and actor_has_folder_shares(sb)
        before = derived_snapshot(ids) if active else {}
    except Exception as e:  # leitura de apoio nunca derruba o gesto do usuario
        logger.warning("[FOLDER_SCOPE] foto anterior falhou: %s", e)
        active, before = False, {}

    yield result

    if not active:
        return
    try:
        diff = diff_snapshots(before, derived_snapshot(ids))
        result["granted"] = _count(diff["granted"])
        result["revoked"] = _count(diff["revoked"])
        result["changed"] = _count(diff["changed"])
        log_access_changes(actor_id, diff)
    except Exception as e:
        logger.warning("[FOLDER_SCOPE] foto posterior falhou: %s", e)
