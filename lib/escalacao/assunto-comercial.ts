import { CAMADA_RESTRICAO_COMERCIAL } from "@/lib/agent-engine/guardrails/camadas-da-org";

/**
 * Triagem conservadora de valores/negociação, nunca valida preço ou condição.
 *
 * Número sozinho NÃO é preço: data e hora com ponto ("dia 15.10 às 14.30"),
 * frequência ("2x ao dia") e porcentagem solta ("40% de visão") passavam por
 * valor e mandavam à equipe conversa de clínica e de agenda. O número só conta
 * com contexto de preço: moeda, parcela ("em 3x", "10x de") ou "% off".
 */
export function contemAssuntoComercialRestrito(texto: string): boolean {
  const normal = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /\b(?:precos?|prec[io]+s?|custa\w*|custos?|quanto (?:fica|sai|e|seria)|descont\w*|negoci\w*|parcel\w*|pagamento\w*|pagar|pag[ao]s?|pix|boleto\w*|credito|debito|promoc\w*|oferta\w*|orcamento\w*|reais|gratis|gratuit\w*|barat\w*|caro|cobran\w*|cobra(?:m|r|mos)?|reembolso\w*|estorno\w*)\b/u.test(normal)
    // "valor" só quando é o do produto: "qual o valor?", "valor da consulta" — não "valor nutricional".
    || /\bvalor(?:es)?(?=\s*(?:$|[?!.,;]|d[aeo]s?\b|total\b|final\b|a vista\b|pra\b|para\b|com desconto\b))/u.test(normal)
    || /(?:r\$|us\$|\$|€|£)\s*\d/u.test(normal)
    || /\b(?:em|ate|de)\s+\d{1,2}\s*x\b|\b\d{1,2}\s*x\s*(?:de\b|sem juros\b|no cartao\b)/u.test(normal)
    || /\b\d+(?:[.,]\d+)?\s*%\s*off\b/u.test(normal)
    // ponytail: vírgula com 2 casas é preço ("299,90"); com ponto é data/hora, e não conta.
    || /\b\d+,\d{2}\b/u.test(normal)
    || /\b(?:fica|sai|apenas|somente|a partir de)\s*(?:por|em)?\s*\d/u.test(normal);
}

/**
 * A organização ligou "valores e negociação com a equipe" (painel Segurança do agente)?
 *
 * Lida à PARTE de `lerCamadasDaOrg`, e não por esquecimento: aquela leitura falha
 * ABERTA (devolve "sem escolha" quando estoura), e aqui a falha precisa ser
 * FECHADA. Leitura que lança derruba o turno — o job volta para a fila e tenta de
 * novo — em vez de virar permissão silenciosa para a IA negociar.
 */
export async function comercialExigeHumano(
  db: { query: (sql: string, values: unknown[]) => Promise<{ rows: Array<{ enabled: unknown }> }> },
  organizationId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    "select enabled from org_guardrail_layers where organization_id = $1 and layer = $2",
    [organizationId, CAMADA_RESTRICAO_COMERCIAL],
  );
  return rows[0]?.enabled === true;
}
