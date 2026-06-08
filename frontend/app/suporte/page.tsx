import Link from "next/link";
import { IconBrandWhatsappFilled, IconMail } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Suporte | Hookify",
  description: "Precisa de ajuda com o Hookify? Fale com a gente pelo WhatsApp ou e-mail.",
};

const WHATSAPP_URL =
  "https://api.whatsapp.com/send/?phone=5532998092905&text=Preciso+de+suporte+no+Hookify";
const EMAIL_PRIMARY = "milazzo@hookifyads.com";
const EMAIL_SECONDARY = "gethookify@gmail.com";

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background text-text">
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-2xl space-y-10">
          <header className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Suporte
            </p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
              Como podemos ajudar?
            </h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              Tem alguma dúvida, encontrou um problema ou quer enviar uma sugestão? Escolha o canal
              que preferir — respondemos o mais rápido possível.
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">WhatsApp</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Atendimento direto e rápido. Clique no botão abaixo para iniciar uma conversa.
            </p>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                <IconBrandWhatsappFilled className="size-5" />
                Falar no WhatsApp
              </a>
            </Button>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">E-mail</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Prefere e-mail? Envie sua mensagem para o nosso endereço principal:
            </p>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <a href={`mailto:${EMAIL_PRIMARY}`}>
                <IconMail className="size-5" />
                {EMAIL_PRIMARY}
              </a>
            </Button>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Endereço secundário:{" "}
              <a
                className="font-medium text-primary underline"
                href={`mailto:${EMAIL_SECONDARY}`}
              >
                {EMAIL_SECONDARY}
              </a>
            </p>
          </section>

          <footer className="pt-2">
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground underline hover:text-text"
            >
              Voltar para o início
            </Link>
          </footer>
        </div>
      </main>
    </div>
  );
}
