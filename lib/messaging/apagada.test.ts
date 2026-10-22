import { describe, expect, it } from "vitest";

import { marcadorDaApagada, textoDaApagadaApareceNaInbox } from "./apagada";

/**
 * A RÉGUA DA MENSAGEM APAGADA — o contrato, num lugar só.
 *
 * Bolha, citação e busca da thread consultam estes dois helpers. Se a régua
 * mudar de ideia, muda AQUI, e é este arquivo que diz — em uma tela — o que o
 * produto decidiu mostrar e o que ele decidiu guardar para a auditoria.
 */
describe("na Inbox, o texto da apagada aparece?", () => {
  it("apagada pelo CONTATO: aparece — o registro do atendimento é do controlador", () => {
    expect(textoDaApagadaApareceNaInbox("inbound")).toBe(true);
  });

  it("apagada pelo ATENDENTE: não aparece — quem apagou não escolhe o que a equipe lê", () => {
    expect(textoDaApagadaApareceNaInbox("outbound")).toBe(false);
  });
});

describe("o marcador da bolha diz QUEM apagou", () => {
  it("recebida é o contato; enviada é a equipe", () => {
    expect(marcadorDaApagada("inbound")).toBe("Esta mensagem foi apagada pelo contato");
    expect(marcadorDaApagada("outbound")).toBe("Esta mensagem foi apagada pelo atendente");
  });
});
