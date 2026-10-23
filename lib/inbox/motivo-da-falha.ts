import { FRASES_DE_FALHA, fraseDaFalhaDeCanal } from "@/lib/channels/frases-de-falha";
import type { Message } from "@/lib/types/messaging";

/**
 * O MOTIVO de uma mensagem que ficou `failed`, na frase que a pessoa lê.
 *
 * ─── Uma régua só, para todo lugar que conta a falha ───────────────────────
 *
 * A mesma linha `failed` aparece em quatro pontos: o tooltip do selo "Falhou",
 * a linha visível embaixo da bolha, o toast do "Tentar de novo" e o toast do
 * encaminhamento (#2835). Eram duas réguas: a linha visível e o reenvio já
 * traduziam o código (#3192), e o tooltip e o encaminhamento mostravam o
 * `error_message` cru — o texto livre do canal, que pode trazer o endereço
 * interno do serviço (`fetch failed http://servico-interno:3000/...`). A mesma
 * falha contava duas histórias, e uma delas vazava a rede da instalação.
 *
 * Por isso `error_message` NÃO entra aqui: o que vale é o `error_code` passado
 * por `FRASES_DE_FALHA`, e código sem frase cai no genérico. O texto cru segue
 * gravado na linha para diagnóstico; só não chega à tela.
 */
export function motivoDaFalhaDaMensagem(
  mensagem: Pick<Message, "error_code">,
  t: (texto: string) => string,
): string {
  const codigo = mensagem.error_code ?? "";
  return fraseDaFalhaDeCanal(codigo)
    // `as string`, e não `!`: é a forma que a cerca de i18n desembrulha para cobrar o espanhol de cada frase.
    ? t(FRASES_DE_FALHA[codigo] as string)
    : t("Não foi possível enviar esta mensagem.");
}
