"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconChevronRight, IconLoader2 } from "@tabler/icons-react";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";

export function InitialSettingsStep(props: { onContinue: () => void }) {
  const [language, setLanguage] = useState<string>("pt-BR");
  const [currency, setCurrency] = useState<string>("BRL");
  const [niche, setNiche] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!language || !currency) {
      showError({ message: "Por favor, preencha todos os campos obrigatórios" });
      return;
    }

    setIsSaving(true);
    try {
      await api.onboarding.saveInitialSettings({
        language,
        currency,
        niche: niche || "",
      });
      showSuccess("Configurações salvas com sucesso!");
      props.onContinue();
    } catch (e: any) {
      showError(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferências</CardTitle>
        <CardDescription>
          Essas configurações podem ser alteradas depois em <strong>Configurações &gt; Preferências</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Idioma */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Idioma</label>
          <Select value={language} onValueChange={setLanguage} disabled={isSaving}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione um idioma" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pt-BR">Português</SelectItem>
              <SelectItem value="en-US" disabled>
                Inglês
              </SelectItem>
              <SelectItem value="es-ES" disabled>
                Espanhol
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">O idioma será aplicado em todas as páginas do app</p>
        </div>

        {/* Moeda */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Moeda</label>
          <Select value={currency} onValueChange={setCurrency} disabled={isSaving}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione uma moeda" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD - Dólar Americano ($)</SelectItem>
              <SelectItem value="EUR">EUR - Euro (€)</SelectItem>
              <SelectItem value="GBP">GBP - Libra Esterlina (£)</SelectItem>
              <SelectItem value="BRL">BRL - Real Brasileiro (R$)</SelectItem>
              <SelectItem value="MXN">MXN - Peso Mexicano ($)</SelectItem>
              <SelectItem value="CAD">CAD - Dólar Canadense ($)</SelectItem>
              <SelectItem value="AUD">AUD - Dólar Australiano ($)</SelectItem>
              <SelectItem value="JPY">JPY - Iene Japonês (¥)</SelectItem>
              <SelectItem value="CNY">CNY - Yuan Chinês (¥)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">A moeda será aplicada em todas as páginas do app</p>
        </div>

        {/* Nicho */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Nicho</label>
          <Input type="text" placeholder="Ex: E-commerce, SaaS, etc." value={niche} onChange={(e) => setNiche(e.target.value)} disabled={isSaving} />
          <p className="text-xs text-muted-foreground">Digite o nicho do seu negócio (opcional)</p>
        </div>

        <div className="flex justify-end">
          <Button variant="default" className="flex items-center gap-1" onClick={handleSave} disabled={isSaving || !language || !currency}>
            {isSaving ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <span>Continuar</span>
                <IconChevronRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
