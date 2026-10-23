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

// O envio de modelo (`send-template-for-session.ts`) grava `<canal>_<código>: <texto
// do provedor>` debaixo do código genérico do adapter. Na v3 isso caía na frase do
// canal — "Confira a conexão em Conexões" —, uma instrução falsa para modelo recusado.
describe("motivoDaFalhaDaMensagem: o prefixo do envio de modelo", () => {
  const CONEXAO = /Confira a conexão/;

  it("código da plataforma com frase nossa: a frase (132000)", () => {
    const m = motivo("meta_error", "meta_132000: (#132000) Number of parameters does not match the expected number of params");
    expect(m).toBe("Os valores enviados não batem com as variáveis do modelo.");
  });

  it("código sem frase nossa: o texto do provedor, com o código à vista (100, o #2659)", () => {
    const m = motivo("meta_error", "meta_100: Parameter name is missing or empty");
    expect(m).toBe("(#100) Parameter name is missing or empty");
    expect(m).not.toMatch(CONEXAO);
  });

  it("o código já no texto do provedor não sai repetido", () => {
    expect(motivo("meta_error", "meta_131009: (#131009) Parameter value is not valid"))
      .toBe("(#131009) Parameter value is not valid");
  });

  it.each([
    ["template_missing: promo (pt_BR) não está no espelho", /^Este modelo não está na lista de modelos do número/],
    ["template_stale: promo mudou na Meta desde a configuração", /^O modelo mudou na plataforma depois de configurado/],
  ])("conferência contra o espelho: %s tem frase própria", (texto, frase) => {
    const m = motivo("meta_error", texto);
    expect(m).toMatch(frase);
    expect(m).not.toMatch(CONEXAO);
  });

  it("recusa sem código e com texto cru: a genérica, nunca a frase do canal", () => {
    expect(motivo("meta_error", "meta_erro: fetch failed http://servico-interno:3000/x")).toBe(GENERICA);
  });

  it("recusa com código e texto do provedor barrado pelo filtro: a genérica", () => {
    expect(motivo("meta_error", "meta_500: connect ECONNREFUSED 10.0.0.5:443")).toBe(GENERICA);
  });

  // DECLARADO no PR: estes dois mudaram de frase. A da plataforma vence a do canal
  // para o código numérico gravado pelo webhook.
  it.each([
    ["131026", "Não foi possível entregar: o número não tem WhatsApp ou o aplicativo está desatualizado."],
    ["131047", "Passaram mais de 24 horas da última mensagem do cliente: fora da janela, só modelo aprovado."],
  ])("webhook %s: a frase da plataforma", (codigo, frase) => {
    expect(motivo(codigo, "Message undeliverable")).toBe(frase);
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
