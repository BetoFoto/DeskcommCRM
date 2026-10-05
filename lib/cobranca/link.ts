/**
 * O link de pagamento vem do banco (gravado a partir da resposta do provedor) e
 * vai para um `href`. Só `https:` passa: `javascript:`, `data:` e `http:` viram
 * null e o botão não renderiza. Puro de propósito: telas de cliente o importam,
 * e `url.ts` lê o env do servidor.
 */
export function linkDePagamentoSeguro(link: string | null | undefined): string | null {
  if (!link || !URL.canParse(link)) return null;
  return new URL(link).protocol === "https:" ? link : null;
}
