"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { IconArrowRight, IconLoader2 } from "@tabler/icons-react";
import { getSupabaseClient } from "@/lib/supabase/client";

// O shader (three.js puro) só é baixado nesta página, nunca no SSR.
const CanvasRevealEffect = dynamic(
  () => import("./CanvasRevealEffect").then((m) => m.CanvasRevealEffect),
  { ssr: false }
);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Step = "email" | "success";

export function WaitlistV2({ source = "waitlist-v2" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("email");
  const [submitting, setSubmitting] = useState(false);
  const [reverseCanvasVisible, setReverseCanvasVisible] = useState(false);
  const [initialCanvasVisible, setInitialCanvasVisible] = useState(true);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      toast.error("Digite um e-mail válido para entrar na lista.");
      return;
    }

    setSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      const referrer = typeof document !== "undefined" ? document.referrer || null : null;
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;

      const { error } = await supabase
        .from("waitlist")
        .insert({ email: value, source, referrer, user_agent: userAgent });

      // 23505 = unique_violation (e-mail já cadastrado) — tratamos como sucesso.
      if (error && error.code !== "23505") throw error;

      if (error?.code === "23505") {
        toast.success("Você já está na lista. Avisaremos quando for sua vez.");
      } else {
        toast.success("Pronto! Você garantiu seu lugar na fila do early access.");
      }

      // Dispara a animação reversa do canvas e transiciona para o sucesso.
      setReverseCanvasVisible(true);
      setTimeout(() => setInitialCanvasVisible(false), 50);
      setTimeout(() => setStep("success"), 1500);
    } catch (err) {
      console.error("Erro ao entrar na waitlist:", err);
      toast.error("Não foi possível registrar agora. Tente novamente em instantes.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full flex-col min-h-screen bg-black relative">
      {/* Camada de fundo: canvas shader + vinheta */}
      <div className="absolute inset-0 z-0">
        {initialCanvasVisible && (
          <div className="absolute inset-0">
            <CanvasRevealEffect
              animationSpeed={3}
              containerClassName="bg-black"
              colors={[
                [120, 220, 255],
                [180, 130, 255],
              ]}
              dotSize={6}
              reverse={false}
            />
          </div>
        )}

        {reverseCanvasVisible && (
          <div className="absolute inset-0">
            <CanvasRevealEffect
              animationSpeed={4}
              containerClassName="bg-black"
              colors={[
                [120, 220, 255],
                [180, 130, 255],
              ]}
              dotSize={6}
              reverse={true}
            />
          </div>
        )}

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,1)_0%,_transparent_100%)]" />
        <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-black to-transparent" />
      </div>

      {/* Camada de conteúdo */}
      <div className="relative z-10 flex flex-col flex-1">
        {/* Topbar minimalista */}
        <header className="flex items-center justify-between px-6 py-6 md:px-10">
          <Image
            src="/logo-hookify-alpha.png"
            alt="Hookify"
            width={130}
            height={35}
            priority
            className="h-[35px] w-[130px]"
          />
          <Link
            href="/login"
            className="px-4 py-2 text-xs sm:text-sm border border-white/15 bg-white/5 text-white/80 rounded-full hover:border-white/40 hover:text-white transition-colors duration-200"
          >
            Já tenho convite
          </Link>
        </header>

        {/* Conteúdo central */}
        <div className="flex flex-1 flex-col justify-center items-center px-6 pb-24">
          <div className="w-full max-w-sm">
            <AnimatePresence mode="wait">
              {step === "email" ? (
                <motion.div
                  key="email-step"
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -24 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="space-y-6 text-center"
                >
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 font-mono text-2xs uppercase tracking-[0.18em] text-white/70">
                    <span className="wl2-blink h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                    Acesso antecipado · vagas limitadas
                  </div>

                  <div className="space-y-2">
                    <h1 className="text-[2.3rem] font-bold leading-[1.05] tracking-tight text-white">
                      Pare de sentir.
                      <br />
                      Comece a enxergar.
                    </h1>
                    <p className="text-base text-white/60 font-light">
                      Entre na lista do Hookify e seja um dos primeiros a analisar anúncios da Meta
                      sem achismo.
                    </p>
                  </div>

                  <form onSubmit={handleEmailSubmit}>
                    <div className="relative">
                      <input
                        type="email"
                        name="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="seu@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={submitting}
                        required
                        aria-label="Seu melhor e-mail"
                        className="w-full backdrop-blur-[1px] text-white bg-white/5 border border-white/10 rounded-full py-3 pl-5 pr-14 focus:outline-none focus:border-white/30 text-center placeholder:text-white/40 disabled:opacity-60"
                      />
                      <button
                        type="submit"
                        disabled={submitting}
                        aria-label="Entrar na lista"
                        className="absolute right-1.5 top-1.5 text-white w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-60"
                      >
                        {submitting ? (
                          <IconLoader2 size={18} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <IconArrowRight size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </form>

                  <p className="text-xs text-white/40 pt-4">
                    Sem spam — só o convite e novidades do lançamento. Ao entrar, você concorda com os{" "}
                    <Link href="/termos-de-uso" className="underline hover:text-white/60 transition-colors">
                      Termos
                    </Link>{" "}
                    e a{" "}
                    <Link
                      href="/politica-de-privacidade"
                      className="underline hover:text-white/60 transition-colors"
                    >
                      Política de Privacidade
                    </Link>
                    .
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="success-step"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut", delay: 0.2 }}
                  className="space-y-6 text-center"
                >
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.4 }}
                    className="flex justify-center"
                  >
                    <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-cyan-300 to-violet-400 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-8 w-8 text-black"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </motion.div>

                  <div className="space-y-2">
                    <h1 className="text-[2.3rem] font-bold leading-[1.05] tracking-tight text-white">
                      Lugar garantido!
                    </h1>
                    <p className="text-base text-white/60 font-light">
                      Você está entre os primeiros. Mandaremos seu convite de acesso por e-mail
                      assim que abrirmos a próxima leva.
                    </p>
                  </div>

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                  >
                    <Link
                      href="/login"
                      className="inline-flex w-full items-center justify-center rounded-full bg-white text-black font-medium py-3 hover:bg-white/90 transition-colors"
                    >
                      Já tenho convite — entrar
                    </Link>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
.wl2-blink { animation: wl2-blink 1.6s ease-in-out infinite; }
@keyframes wl2-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .wl2-blink { animation: none; } }
`,
        }}
      />
    </div>
  );
}

export default WaitlistV2;
