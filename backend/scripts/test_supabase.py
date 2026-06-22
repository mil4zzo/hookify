import os
import sys
import uuid
import traceback
from datetime import datetime, UTC

# Permitir import relativo ao executar via `python -m backend.scripts.test_supabase`
from app.core.supabase_client import get_supabase


def main() -> int:
    print("=== Supabase CRUD Smoke Test ===")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("ERRO: SUPABASE_URL e/ou SUPABASE_KEY não definidos no ambiente.")
        return 2

    sb = get_supabase()

    # Usaremos a tabela 'jobs' para um CRUD simples (não destrutivo de dados reais)
    test_job_id = str(uuid.uuid4())
    test_user_id = str(uuid.uuid4())  # UUID fictício apenas para teste de escrita

    try:
        print("[1/4] INSERT")
        ins = {
            "id": test_job_id,
            "user_id": test_user_id,
            "status": "running",
            "progress": 0,
            "message": "smoke-test",
            "payload": {"ts": datetime.now(UTC).isoformat()},
            "result_count": 0,
        }
        res_ins = sb.table("jobs").insert(ins).execute()
        print(f"  -> inserted id={test_job_id}")
        print(f"    insert.data={getattr(res_ins, 'data', None)}")

        print("[2/4] SELECT")
        sel = sb.table("jobs").select("id,status,progress,message,user_id").eq("id", test_job_id).execute()
        rows = sel.data or []
        assert rows and rows[0]["id"] == test_job_id, "Registro não encontrado após insert"
        print(f"  -> selected row: {rows[0]}")

        print("[3/4] UPDATE")
        res_upd = sb.table("jobs").update({"status": "completed", "progress": 100, "message": "smoke-ok"}).eq("id", test_job_id).execute()
        print(f"    update.data={getattr(res_upd, 'data', None)}")
        sel_upd = sb.table("jobs").select("id,status,progress,message").eq("id", test_job_id).execute()
        upd_rows = sel_upd.data or []
        if not upd_rows:
            raise RuntimeError("Registro não encontrado após update")
        print(f"  -> updated row: {upd_rows[0]}")

        print("[4/4] DELETE")
        res_del = sb.table("jobs").delete().eq("id", test_job_id).execute()
        print("  -> deleted")
        print(f"    delete.data={getattr(res_del, 'data', None)}")

        print("SUCCESS: Conexão e CRUD básicos funcionando.")
        return 0
    except Exception as e:
        print("FALHA no teste de CRUD:", repr(e))
        print("\nTraceback:")
        traceback.print_exc()
        # Tentar capturar detalhes típicos do Postgrest/Supabase
        try:
            msg = getattr(e, "message", None)
            details = getattr(e, "details", None)
            hint = getattr(e, "hint", None)
            code = getattr(e, "code", None)
            resp = getattr(e, "response", None)
            if msg or details or hint or code or resp:
                print("\nException details:")
                if msg: print(f"  message: {msg}")
                if details: print(f"  details: {details}")
                if hint: print(f"  hint: {hint}")
                if code: print(f"  code: {code}")
                if resp: print(f"  response: {resp}")
        except Exception:
            pass
        # Dicas comuns
        print("\nPossíveis causas e soluções:")
        print("- Verifique SUPABASE_URL/SUPABASE_KEY (.env do backend). Use Service Role Key no backend.")
        print("- Execute o schema supabase/schema.sql para criar tabelas, índices e RLS.")
        print("- Se usar anon key (não recomendado), RLS pode bloquear inserts. Use service role.")
        print("- Verifique se a tabela 'jobs' existe e RLS está habilitado com políticas compatíveis.")
        return 1


if __name__ == "__main__":
    sys.exit(main())


