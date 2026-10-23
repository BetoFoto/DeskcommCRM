import { FRASES_DE_FALHA, fraseDaFalhaDeCanal } from "@/lib/channels/frases-de-falha";
import type { Message } from "@/lib/types/messaging";

/**
 * A frase dos códigos que NÓS gravamos com texto de tela, quando ela não está
 * em `FRASES_DE_FALHA` ou lá fala de outro contexto: é o texto que
 * `messages/_handler.ts` (modo de teste, canal excluído) e o watchdog de
 * `session-reconciler.ts` (organização suspensa) gravam em `error_message`.
 * A de `channel_archived` em `FRASES_DE_FALHA` diz "nesta automação" — e numa
 * conversa ou num encaminhamento não há automação.
 */
const FRASES_DA_CONVERSA: Record<string, string> = {
  pre_go_live: "Envio automático bloqueado pelo modo de teste do canal.",
  pre_go_live_indisponivel: "Não foi possível verificar o acesso da IA. Nenhuma mensagem foi enviada.",
  org_suspensa: "Envio automático bloqueado: a organização está suspensa.",
  channel_archived: "Este número foi excluído da Central de Conexões.",
};

/**
 * Sinais de texto CRU do transporte: URL, IP, host:porta, erro de rede do
 * Node, linha de stack e o prefixo de código que o adapter põe na frente
 * (`canal_400: …`, `canal_unknown`). É esse texto que traz o endereço interno
 * do serviço (`fetch failed http://servico-interno:3000/...`).
 */
const SINAL_DE_TEXTO_CRU =
  /https?:\/\/|[Ff]etch failed|\bE[A-Z_]{4,}\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[A-Za-z][\w.-]*:\d{2,5}\b|^[a-z0-9]+_[a-z0-9_]+|\n\s+at\s/;

/**
 * O MOTIVO de uma mensagem que ficou `failed`, na frase que a pessoa lê — o
 * mesmo texto no selo "Falhou", na linha embaixo da bolha, no "Tentar de
 * novo", no encaminhamento (#2835) e no envio de modelo com a janela fechada.
 *
 * A ordem, e o porquê:
 * 1. a frase nossa do código (`FRASES_DA_CONVERSA`, depois `FRASES_DE_FALHA`);
 * 2. o `error_message` sem sinal de texto cru — os títulos de falha da
 *    plataforma oficial (`meta/status-update.ts`) só têm frase para 131026 e
 *    131047, e o título é a única pista dos outros. Vai SEM `t()`: é dado do
 *    provedor, não chave de dicionário;
 * 3. a frase genérica. O texto cru não some: segue na linha, para diagnóstico.
 */
export function motivoDaFalhaDaMensagem(
  mensagem: Pick<Message, "error_message" | "error_code">,
  t: (texto: string) => string,
): string {
  const codigo = mensagem.error_code ?? "";
  if (Object.hasOwn(FRASES_DA_CONVERSA, codigo)) return t(FRASES_DA_CONVERSA[codigo] as string);
  if (fraseDaFalhaDeCanal(codigo)) {
    // `as string`, e não `!`: é a forma que a cerca de i18n desembrulha para cobrar o espanhol de cada frase.
    return t(FRASES_DE_FALHA[codigo] as string);
  }
  const gravado = mensagem.error_message?.trim() ?? "";
  if (gravado && !SINAL_DE_TEXTO_CRU.test(gravado)) return gravado;
  return t("Não foi possível enviar esta mensagem.");
}
