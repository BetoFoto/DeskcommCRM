import { describe, expect, it } from "vitest";
import { motivoDaFalhaDaMensagem } from "./motivo-da-falha";

const t = (s: string) => s;
const motivo = (error_code: string | null, error_message: string | null) =>
  motivoDaFalhaDaMensagem({ error_code, error_message }, t);
const GENERICA = "Não foi possível enviar esta mensagem.";

describe("motivoDaFalhaDaMensagem: a frase nossa aparece", () => {
  it.each([
    ["pre_go_live", "Envio automático bloqueado pelo modo de teste do canal."],
    ["pre_go_live_indisponivel", "Não foi possível verificar o acesso da IA. Nenhuma mensagem foi enviada."],
    ["org_suspensa", "Envio automático bloqueado: a organização está suspensa."],
  ])("%s mostra a frase que o envio grava", (codigo, texto) => {
    expect(motivo(codigo, texto)).toBe(texto);
  });

  it("canal excluído: a frase do envio, sem falar de automação", () => {
    const m = motivo("channel_archived", "Este número foi excluído da Central de Conexões.");
    expect(m).toBe("Este número foi excluído da Central de Conexões.");
    expect(m).not.toMatch(/automação/);
  });

  it("título de um código que nenhum mapa conhece é a única pista: aparece", () => {
    expect(motivo("131999", "Some new platform failure title."))
      .toBe("Some new platform failure title.");
  });
});

// O envio de modelo grava o código GENÉRICO do adapter e põe a causa no texto.
// A frase genérica do canal ("confira a conexão") mentiria: em 21/09 um modelo
// com cabeçalho de imagem virou `template_missing_values: 1` (JanelaFechadaAviso).
describe("motivoDaFalhaDaMensagem: a recusa do modelo diz a causa", () => {
  it.each([
    ["template_missing_values: 1", "Falta o valor de uma variável do modelo para este contato."],
    ["canal_x_template_failed: 400 bad [plataforma:132000]", "Os valores enviados não batem com as variáveis do modelo."],
  ])("código genérico do adapter + %s", (texto, frase) => {
    expect(motivo("canal_x_error", texto)).toBe(frase);
  });

  it("código numérico da plataforma com frase própria: a frase em português, não o título", () => {
    expect(motivo("131049", "This message was not delivered to maintain healthy ecosystem engagement."))
      .toMatch(/^O WhatsApp limitou quantas promoções/);
  });
});

describe("motivoDaFalhaDaMensagem: o texto cru do canal não aparece", () => {
  it("código com frase própria: a frase, não o texto do transporte", () => {
    const m = motivo("channel_session_not_working", "fetch failed http://servico-interno:3000/api/sendText");
    expect(m).toContain("O número escolhido não está conectado no momento.");
  });

  it.each([
    "fetch failed http://servico-interno:3000/api/sendText",
    "connect ECONNREFUSED 10.0.0.5:3000",
    "getaddrinfo ENOTFOUND servico-interno",
    "request to servico-interno:3000 timed out",
    "canal_x_400: invalid token",
    "canal_x_unknown",
    "Error: boom\n    at enviar (/app/lib/x.ts:10:5)",
  ])("código sem frase + texto cru (%s) cai na genérica", (texto) => {
    expect(motivo("canal_x_error", texto)).toBe(GENERICA);
  });

  it("sem nada gravado: a genérica", () => {
    expect(motivo(null, null)).toBe(GENERICA);
  });
});
