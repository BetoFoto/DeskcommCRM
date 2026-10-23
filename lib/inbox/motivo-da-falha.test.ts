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

  it("título da plataforma oficial sem frase própria é a única pista: aparece", () => {
    expect(motivo("131049", "This message was not delivered to maintain healthy ecosystem engagement."))
      .toBe("This message was not delivered to maintain healthy ecosystem engagement.");
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
