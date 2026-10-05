"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

/** O link que o revendedor manda pelo WhatsApp da empresa atrasada: recupera receita sem esperar a régua. */
export function CopiarLinkDePagamento({ link }: { link: string }) {
  const t = useT();
  async function copiar() {
    await navigator.clipboard.writeText(link);
    toast.success(t("Link copiado. Mande para a empresa pelo WhatsApp."));
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void copiar()}>
      {t("Copiar link de pagamento")}
    </Button>
  );
}
