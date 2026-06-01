"use client";

import { useState } from "react";
import { toast } from "sonner";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseClient } from "@/lib/supabase/client";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Status = "idle" | "submitting" | "success";

export function WaitlistForm({ source = "waitlist" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;

    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      toast.error("Digite um e-mail válido para entrar na lista.");
      return;
    }

    setStatus("submitting");

    try {
      const supabase = getSupabaseClient();
      const referrer = typeof document !== "undefined" ? document.referrer || null : null;
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;

      const { error } = await supabase
        .from("waitlist")
        .insert({ email: value, source, referrer, user_agent: userAgent });

      if (error) {
        // 23505 = unique_violation (e-mail já cadastrado)
        if (error.code === "23505") {
          setStatus("success");
          toast.success("Você já está na lista. Avisaremos quando sua vez chegar.");
          return;
        }
        throw error;
      }

      setStatus("success");
      toast.success("Pronto! Sua condição de fundador está garantida.");
    } catch (err) {
      console.error("Erro ao entrar na waitlist:", err);
      setStatus("idle");
      toast.error("Não foi possível registrar agora. Tente novamente em instantes.");
    }
  }

  if (status === "success") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-success-30 bg-success-10 p-4 text-left">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-background">
          <IconCheck size={16} stroke={3} aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-text">Condição de fundador garantida.</p>
          <p className="text-sm text-muted-foreground">
            Você entrou na frente da fila. Estamos liberando o acesso aos poucos — você é avisado por
            e-mail assim que sua vez chegar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          required
          aria-label="Seu melhor e-mail"
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "submitting"}
          className="!h-12 flex-1 text-base"
        />
        <Button
          type="submit"
          size="lg"
          disabled={status === "submitting"}
          className="h-12 shrink-0 px-6"
        >
          {status === "submitting" ? (
            <span className="inline-flex items-center gap-2">
              <IconLoader2 size={18} className="animate-spin" aria-hidden="true" />
              Entrando…
            </span>
          ) : (
            "Quero acesso antecipado"
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Grátis pra entrar. Condição de fundador pra quem chega cedo — pode encerrar a qualquer
        momento. Sem spam.
      </p>
    </form>
  );
}
