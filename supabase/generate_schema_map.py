"""
Gera supabase/schema_map.md a partir do supabase/schema.sql atual.

Uso:
    py supabase/generate_schema_map.py

Quando rodar:
    - Sempre após atualizar o schema.sql com pg_dump (sync com remoto)
    - Após criar uma nova migration que adiciona/remove tabelas ou colunas

O schema.sql deve ser atualizado primeiro:
    pg_dump "postgresql://postgres:SENHA@db.yyhiwayyvawsdsptdklx.supabase.co:5432/postgres" \\
      --schema-only --schema=public -f supabase/schema.sql
"""

import re
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SCHEMA_FILE = REPO_ROOT / "supabase" / "schema.sql"
OUTPUT_FILE = REPO_ROOT / "supabase" / "schema_map.md"

# Descrições das tabelas — atualize aqui ao criar novas tabelas
TABLE_DESCRIPTIONS = {
    "ad_accounts": "Contas de anúncios do Meta vinculadas a um usuário.",
    "ad_metric_pack_map": "Mapa de relacionamento entre métricas de anúncios e packs (tabela de junção).",
    "ad_metrics": "Métricas diárias de performance de cada anúncio, importadas da Meta API.",
    "ad_sheet_integrations": "Integrações com Google Sheets para importar leadscores via planilha.",
    "ad_transcriptions": "Transcrições de áudio/vídeo dos criativos de anúncios via AssemblyAI.",
    "ads": "Anúncios importados da Meta API com metadados do criativo.",
    "bulk_ad_items": "Itens individuais de um job de criação em lote de anúncios no Meta.",
    "facebook_connections": "Conexões OAuth do Facebook vinculadas a usuários.",
    "google_accounts": "Contas Google OAuth vinculadas a usuários (para acesso ao Sheets).",
    "jobs": "Jobs assíncronos de longa duração (ex: criação em lote de anúncios).",
    "packs": "Agrupamentos de anúncios definidos pelo usuário para análise comparativa.",
    "profiles": "Perfil do usuário com dados básicos do Facebook OAuth.",
    "user_preferences": "Preferências e configurações personalizadas por usuário.",
}

# Notas extras por tabela (exibidas após a tabela de colunas)
TABLE_NOTES = {
    "jobs": "**Status válidos:** `pending`, `running`, `processing`, `persisting`, `meta_running`, `meta_completed`, `completed`, `failed`, `error`, `cancelled`",
}


def extract_tables(content: str) -> dict:
    tables = {}
    blocks = re.split(r'\nCREATE TABLE ', content)

    for block in blocks[1:]:
        name_match = re.match(r'public\.(\w+)\s*\(', block)
        if not name_match:
            continue
        table_name = name_match.group(1)
        paren_end = block.find('\n);')
        if paren_end == -1:
            continue
        body = block[block.find('(') + 1:paren_end]
        cols = []
        for line in body.split('\n'):
            line = line.strip().rstrip(',')
            if not line:
                continue
            upper = line.upper()
            if upper.startswith(('PRIMARY KEY', 'UNIQUE', 'CONSTRAINT', 'CHECK', '--')):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            col_name = parts[0]
            col_type = parts[1]
            flags = []
            if 'NOT NULL' in upper:
                flags.append('NOT NULL')
            if 'DEFAULT' in upper:
                flags.append('DEFAULT')
            cols.append((col_name, col_type, flags))
        tables[table_name] = cols

    return tables


def generate_markdown(tables: dict) -> str:
    today = date.today().isoformat()
    lines = [
        "# Schema Map — Hookify",
        "",
        "Mapa compacto do schema do banco. **Fonte da verdade: `schema.sql`** (gerado via pg_dump).  ",
        "Este arquivo é gerado automaticamente por `supabase/generate_schema_map.py` — não edite manualmente.",
        "",
        "**Quando usar este arquivo:** para saber quais colunas e tipos existem em cada tabela.  ",
        "**Quando usar `schema.sql`:** para detalhes de constraints, índices, RLS policies, funções/RPCs, triggers.",
        "",
        "---",
        "",
        "## Tabelas",
    ]

    for table_name in sorted(tables.keys()):
        cols = tables[table_name]
        description = TABLE_DESCRIPTIONS.get(table_name, "")
        note = TABLE_NOTES.get(table_name, "")

        lines.append("")
        lines.append(f"### {table_name}")
        if description:
            lines.append(description)
        lines.append("")
        lines.append("| Coluna | Tipo | Flags |")
        lines.append("|--------|------|-------|")
        for col_name, col_type, flags in cols:
            flag_str = ", ".join(flags)
            lines.append(f"| {col_name} | {col_type} | {flag_str} |")
        if note:
            lines.append("")
            lines.append(note)
        lines.append("")
        lines.append("---")

    lines.append("")
    lines.append(f"*Gerado em: {today} — via `supabase/generate_schema_map.py`*")
    lines.append("")

    return "\n".join(lines)


def main():
    if not SCHEMA_FILE.exists():
        print(f"Erro: {SCHEMA_FILE} não encontrado.")
        return

    content = SCHEMA_FILE.read_text(encoding="utf-8")
    tables = extract_tables(content)

    if not tables:
        print("Nenhuma tabela encontrada no schema.sql.")
        return

    markdown = generate_markdown(tables)
    OUTPUT_FILE.write_text(markdown, encoding="utf-8")

    print(f"schema_map.md gerado com sucesso: {len(tables)} tabelas.")
    for name in sorted(tables.keys()):
        print(f"  - {name} ({len(tables[name])} colunas)")


if __name__ == "__main__":
    main()
