"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, Suspense } from "react";
import Image from "next/image";
import { IconEye, IconEyeOff, IconBrandGoogle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { showError, showSuccess, showWarning } from "@/lib/utils/toast";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { useSearchParams } from "next/navigation";
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth";
import { LoadingState } from "@/components/common/States";

function LoginContent() {
  const t = useTranslations("auth.login");
  const searchParams = useSearchParams();
  const { isClient } = useClientAuth();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useSupabaseAuth();
  const [isSignUp, setIsSignUp] = useState(searchParams.get("mode") === "signup");
  const [isProcessing, setIsProcessing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const expiredWarningShownRef = useRef(false);

  // Verificar se há redirect após login
  const redirectTo = searchParams.get("redirect") || "/packs";

  useEffect(() => {
    if (expiredWarningShownRef.current || searchParams.get("expired") !== "true") return;

    expiredWarningShownRef.current = true;
    showWarning(t("expired"));
  }, [searchParams, t]);

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
        showSuccess(t("accountCreated"));
        // Usar window.location para forçar reload completo e garantir que a sessão seja carregada
        // Isso garante que todos os hooks sejam reinicializados com a nova sessão
        window.location.href = redirectTo;
      } else {
        // Se não há sessão, precisa confirmar email (caso a confirmação seja habilitada no futuro)
        showSuccess(t("signUpDone"));
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

  const handleGoogle = async () => {
    try {
      setIsProcessing(true);
      await signInWithGoogle();
    } catch (error: any) {
      showError(error);
      setIsProcessing(false);
    }
  };

  // Só renderizar quando estiver no cliente para evitar problemas de hidratação
  if (!isClient) {
    return (
      <div className="w-full max-w-md space-y-6 mx-auto">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-6 px-4 mx-auto">
      {/* Card com formulário */}
      <Card>
        <CardHeader className="mb-4">
          {isSignUp ? (
            <CardTitle className="text-center">{t("createAccount")}</CardTitle>
          ) : (
            <div className="flex justify-center mb-2">
              <Image src="/logo-hookify-alpha.png" alt="Hookify" width={120} height={32} className="h-[32px] w-[120px]" priority />
            </div>
          )}
          <CardDescription className="text-center">{isSignUp ? t("signUpSubtitle") : t("signInSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={isSignUp ? handleSignUp : handleEmailLogin}>
            <div className="space-y-8">
              <div className="space-y-4">
                {isSignUp && (
                  <div className="space-y-2">
                    <label className="text-sm">{t("name")}</label>
                    <Input type="text" placeholder={t("namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} required className="" />
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm">{t("email")}</label>
                  <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm">{t("password")}</label>
                  <div className="relative">
                    <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
                    <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t("hidePassword") : t("showPassword")}>
                      {showPassword ? <IconEyeOff className="h-4 w-4 text-muted-foreground" /> : <IconEye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </div>
                </div>
              </div>
              <Button type="submit" className="w-full h-[42px]" disabled={isProcessing}>
                {isProcessing ? t("processing") : isSignUp ? t("createAccount") : t("signIn")}
              </Button>
            </div>
          </form>

          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">{t("or")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button type="button" variant="secondary" className="mt-4 w-full h-[42px]" onClick={handleGoogle} disabled={isProcessing}>
            <IconBrandGoogle className="h-4 w-4 mr-2" />
            {isSignUp ? t("googleSignUp") : t("googleSignIn")}
          </Button>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {isSignUp ? (
              <>
                {t("haveAccount")}{" "}
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
                  {t("signInNow")}
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
  const t = useTranslations("auth.login");
  return (
    <Suspense fallback={<LoadingState label={t("loading")} />}>
      <LoginContent />
    </Suspense>
  );
}
