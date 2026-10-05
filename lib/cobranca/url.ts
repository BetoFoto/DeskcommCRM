/**
 * O endereço que o provedor chama (spec §7a). O provedor só entrega aviso em
 * https público; `urlPublicaUsavel` aceita http e por isso o protocolo é
 * conferido aqui. Exceção única: com o dublê de teste ligado (loopback, e o app
 * em loopback — `baseDeTesteDaCobranca`), o endereço de bancada vale.
 */
import type { ProvedorDeCobranca } from "@/lib/cobranca/vocabulario";
import { urlPublicaUsavel } from "@/lib/escalacao/url-publica";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function urlDoWebhookDaCobranca(base: string, provedor: ProvedorDeCobranca, aceitaLoopback: boolean): string | null {
  const limpa = base.trim().replace(/\/+$/, "");
  if (!URL.canParse(limpa)) return null;
  const url = new URL(limpa);
  const publica = url.protocol === "https:" && urlPublicaUsavel(limpa);
  const deBancada = aceitaLoopback && LOOPBACK.has(url.hostname);
  return publica || deBancada ? `${limpa}/api/v1/webhooks/cobranca/${provedor}` : null;
}
