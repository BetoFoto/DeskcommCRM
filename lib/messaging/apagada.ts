/**
 * A régua de QUEM vê o CONTEÚDO de uma mensagem apagada ("apagar para todos").
 *
 * ─── O que NÃO depende da régua ─────────────────────────────────────────────
 *
 * A linha nunca sai do fio e o corpo nunca é limpo: quem some com a linha deixa
 * a resposta seguinte respondendo ao nada e apaga o histórico de quem atendeu
 * (`handleMessageRevoked` do ingest, que só carimba `revoked_at`). O que esta
 * régua decide é o TEXTO — e ela é a única fonte, porque as superfícies que a
 * consultam têm de concordar entre si: a bolha, a citação dentro de outra bolha
 * e a busca da thread. Divergir ali é o modo de falha caro (a busca marcando
 * bolha cujo termo ninguém vê, ou o inverso).
 *
 * ─── Por que a Inbox é assimétrica ─────────────────────────────────────────
 *
 * • apagada pelo CONTATO — o texto CONTINUA visível ao atendente. O "apagar
 *   para todos" do aplicativo é gesto do titular no canal, **não** pedido de
 *   eliminação: o registro do que foi combinado no atendimento é do controlador
 *   e sustenta a defesa dele. O caminho de eliminação do titular é o pedido de
 *   LGPD desta casa, que anonimiza de verdade e é ele que zera o corpo
 *   (`lib/lgpd/cascata.ts`, `messages.redacted_at`/`media_derived_text`).
 * • apagada pelo ATENDENTE (mensagem nossa) — o texto SAI da Inbox. Quem apaga
 *   o próprio envio não escolhe o que a equipe lê na tela; o conteúdo segue
 *   íntegro na linha, e quem o entrega é a exportação da conversa, onde a prova
 *   se lê (art. 18, II e V — a mesma razão de a rota de export existir).
 *
 * ─── As outras duas superfícies (decididas aqui, para não se espalharem) ───
 *
 * • EXPORTAÇÃO da conversa: entrega o texto nos DOIS sentidos, marcado com quem
 *   apagou. É o documento que o operador guarda no caso — esconder ali o que a
 *   Inbox mostra, ou mostrar ali o que a Inbox esconde, deixaria o PDF sem
 *   utilidade justamente para o que ele existe.
 * • AUDITORIA: registra o EVENTO (quem apagou, qual mensagem, quando, e que o
 *   conteúdo foi preservado) e **nunca copia o corpo**. `api_audit_log` é
 *   append-only, com retenção de 5 anos, e sobrevive ao apagamento da
 *   organização — copiar o texto para lá criaria dado pessoal fora do alcance
 *   da cascata de anonimização. O conteúdo fica na linha, onde a retenção e o
 *   pedido de LGPD o alcançam; a trilha aponta o `resource_id`.
 */
export type DirecaoDaMensagem = "inbound" | "outbound";

/**
 * O texto de uma mensagem apagada aparece na Inbox?
 *
 * `true` para a apagada pelo contato (o CRM preserva e mostra o que foi
 * combinado), `false` para a apagada pelo atendente (a tela não devolve a quem
 * apagou o próprio envio a chance de escolher o que a equipe vê).
 */
export function textoDaApagadaApareceNaInbox(direction: DirecaoDaMensagem): boolean {
  return direction === "inbound";
}

/** O marcador da bolha, pela mesma direção — a frase diz QUEM apagou. */
export function marcadorDaApagada(direction: DirecaoDaMensagem): string {
  return direction === "inbound"
    ? "Esta mensagem foi apagada pelo contato"
    : "Esta mensagem foi apagada pelo atendente";
}
