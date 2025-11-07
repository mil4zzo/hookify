"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth";
import { showError, showSuccess } from "@/lib/utils/toast";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const { signUpWithEmail, signInWithGoogle } = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      await signUpWithEmail(email, password);
      showSuccess("Cadastro realizado! Verifique seu email para confirmar.");
      router.push("/login");
    } catch (e: any) {
      showError(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogle = async () => {
    try {
      setIsLoading(true);
      await signInWithGoogle();
    } catch (e: any) {
      showError(e);
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-6 px-4">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold">Criar conta</h1>
        <p className="text-muted-foreground">Use email e senha ou Google</p>
      </div>

      <div className="space-y-4">
        <form onSubmit={handleSignup} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <label className="text-sm">Senha</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Processando..." : "Criar conta"}
          </Button>
        </form>

        <div className="space-y-2">
          <Button variant="secondary" className="w-full" onClick={handleGoogle} disabled={isLoading}>
            Entrar com Google
          </Button>
        </div>
      </div>
    </div>
  );
}


