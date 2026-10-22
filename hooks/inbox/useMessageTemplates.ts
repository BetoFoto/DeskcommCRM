"use client";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { MidiaDeTemplate } from "@/lib/templates/midias";

export interface MessageTemplate {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  owner_user_id: string | null;
  /**
   * As imagens que o próprio operador carregou no template (#2526).
   * Opcional de propósito: linha anterior à migration 0643 e fixture de teste
   * vêm sem a chave, e as duas são "só texto" — nenhum dos dois casos pode
   * quebrar quem lê.
   */
  midias?: MidiaDeTemplate[] | null;
  /**
   * "Mostrar na barra do Inbox" (#3282) — `message_templates.mostrar_na_barra`.
   * Opcional/lido como ligado por ausência: linha anterior à migration 0742 e
   * fixture sem a chave aparecem na barra, como sempre.
   */
  mostrar_na_barra?: boolean | null;
}

/** Onda 5: templates de script (pessoais + compartilhados) para o slash-menu do composer. */
export function useMessageTemplates() {
  const podeConsultar = usePermission("message-templates.view");
  return useQuery({
    enabled: podeConsultar,
    queryKey: ["message-templates"],
    queryFn: async () => apiClient.get<{ data: MessageTemplate[] }>("/api/v1/message-templates"),
    staleTime: 60_000,
    select: (res) => res.data,
  });
}
