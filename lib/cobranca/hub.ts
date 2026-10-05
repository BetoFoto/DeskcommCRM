import type { TipoDeSuspensao } from "@/lib/organizacao/operante";

/**
 * O que o hub de conta suspensa mostra (spec da cobrança §9, §7d.5): quem
 * administra uma empresa suspensa POR FALTA DE PAGAMENTO vê como pagar — e
 * volta sozinho ao pagar. Suspensão administrativa segue com o contato de quem
 * opera; quem não administra é mandado a quem administra.
 */
export function oQueOHubMostra(o: {
  administra: boolean;
  tipo: TipoDeSuspensao | null;
  cobrancaLigada: boolean;
  temAssinatura: boolean;
}): "pagamento" | "contato" | "avise_o_admin" {
  if (!o.administra) return "avise_o_admin";
  return o.tipo === "cobranca" && o.cobrancaLigada && o.temAssinatura ? "pagamento" : "contato";
}
