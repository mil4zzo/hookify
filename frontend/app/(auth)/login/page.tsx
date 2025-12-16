"use client";
import { useState, Suspense } from "react";
import Image from "next/image";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { showError, showSuccess } from "@/lib/utils/toast";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { useRouter, useSearchParams } from "next/navigation";
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth";
import { LoadingState } from "@/components/common/States";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isClient } = useClientAuth();
  const { signInWithEmail, signUpWithEmail } = useSupabaseAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Verificar se há redirect após login
  const redirectTo = searchParams.get("redirect") || "/packs";

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsProcessing(true);
      await signInWithEmail(email, password);
      // Usar window.location para forçar reload completo e garantir que a sessão seja carregada
      // Isso garante que todos os hooks sejam reinicializados com a nova sessão
      window.location.href = redirectTo;
    } catch (error: any) {
      showError(error);
      setIsProcessing(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsProcessing(true);
      const data = await signUpWithEmail(email, password, { name });

      // Se há sessão, o usuário foi autenticado automaticamente (confirmação de email desabilitada)
      if (data?.session) {
        showSuccess("Conta criada com sucesso! Bem-vindo!");
        // Usar window.location para forçar reload completo e garantir que a sessão seja carregada
        // Isso garante que todos os hooks sejam reinicializados com a nova sessão
        window.location.href = redirectTo;
      } else {
        // Se não há sessão, precisa confirmar email (caso a confirmação seja habilitada no futuro)
        showSuccess("Cadastro realizado! Verifique seu email para confirmar.");
        setIsSignUp(false);
        setEmail("");
        setPassword("");
        setName("");
      }
    } catch (error: any) {
      showError(error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Só renderizar quando estiver no cliente para evitar problemas de hidratação
  if (!isClient) {
    return (
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold">Entrar</h1>
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-6 px-4">
      {/* Logo */}
      <div className="flex justify-center mb-4">
        <Image src="/logo-hookify-alpha.png" alt="Hookify" width={120} height={32} className="h-[32px] w-[120px]" priority />
      </div>

      {/* Card com formulário */}
      <Card>
        <CardHeader className="mb-4">
          <CardTitle className="text-center">{isSignUp ? "Criar conta" : "Entrar"}</CardTitle>
          <CardDescription className="text-center">{isSignUp ? "Crie sua conta para começar" : "Acesse sua conta para continuar"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={isSignUp ? handleSignUp : handleEmailLogin}>
            <div className="space-y-8">
              <div className="space-y-4">
                {isSignUp && (
                  <div className="space-y-2">
                    <label className="text-sm">Nome</label>
                    <Input type="text" placeholder="Seu nome completo" value={name} onChange={(e) => setName(e.target.value)} required className="placeholder:text-foreground/60" />
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm">Email</label>
                  <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="placeholder:text-foreground/60" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm">Senha</label>
                  <div className="relative">
                    <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10 placeholder:text-foreground/60" />
                    <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                      {showPassword ? <IconEyeOff className="h-4 w-4 text-muted-foreground" /> : <IconEye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </div>
                </div>
              </div>
              <Button type="submit" className="w-full h-[42px]" disabled={isProcessing}>
                {isProcessing ? "Processando..." : isSignUp ? "Criar conta" : "Entrar"}
              </Button>
            </div>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {isSignUp ? (
              <>
                Já tem uma conta?{" "}
                <Button
                  type="button"
                  variant="link"
                  className="p-0 h-auto text-sm font-normal underline"
                  onClick={() => {
                    setIsSignUp(false);
                    setEmail("");
                    setPassword("");
                    setName("");
                  }}
                >
                  Entrar agora
                </Button>
              </>
            ) : (
              <>
                Don't have an account?{" "}
                <Button type="button" variant="link" className="p-0 h-auto text-sm font-normal underline" onClick={() => setIsSignUp(true)}>
                  Sign Up Now
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingState label="Carregando..." />}>
      <LoginContent />
    </Suspense>
  );
}
