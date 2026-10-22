import { describe, expect, it } from "vitest";
import { contemAssuntoComercialNaSaida, contemAssuntoComercialRestrito, comercialExigeHumano } from "./assunto-comercial";

describe("valores e negociação somente humanos", () => {
  it.each(["Quanto custa?", "Qual o preço dos óculos?", "Tem desconto?", "Pode parcelar?",
    "Passa o Pix", "Quero um orçamento", "Está grátis?", "A promoção vale?", "R$ 199,90",
    "Tenho boleto", "Quero pagar", "Preciso de reembolso",
    "Está caro", "Aceptan pago con tarjeta?", "Qual o valor?", "Condição de crédito", "Fica 299", "A partir de 199", "299,90",
    "Quanto custa o óculos?", "Fica R$ 250,00 em 3x", "Dá para fazer em 10x?", "São 10x de 29,90",
    "Quanto vocês cobram?", "Qual o valor da consulta?", "Tem 10% off?"])
    ("não entrega condição comercial: %s", s => expect(contemAssuntoComercialRestrito(s)).toBe(true));
  // Número sozinho não é preço. Os seis do meio entraram na triagem do #2877: data e
  // hora com ponto, frequência de remédio, porcentagem de saúde, "cobre" e "valor
  // nutricional" mandavam à equipe conversa de clínica e de agenda.
  it.each(["Rua das Flores, 2054", "Avenida dos Exemplos, 1317", "Sala 01",
    "(11) 4000-0000", "Abre às 8:30?", "Quero o Maps", "Falar com a unidade A", "Bom dia",
    "Tem armações?", "Segunda a sexta", "Gostei do atendimento",
    "dia 15.10 às 14.30", "Abrimos às 9.00", "Tome 1 comprimido 2x ao dia", "Estou com 40% de visão",
    "O plano cobre isso?", "Me fala o valor nutricional", "15/10 às 14:30"])
    ("não confunde rotina/endereço com preço: %s", s => expect(contemAssuntoComercialRestrito(s)).toBe(false));
  it("falha de leitura não vira permissão", async () => {
    await expect(comercialExigeHumano({ query: async () => { throw Error("offline"); } }, "org"))
      .rejects.toThrow("offline");
  });
  it.each([true, false, "true", undefined])("só booleano true liga: %s", async enabled => {
    expect(await comercialExigeHumano({ query: async () => ({ rows: [{ enabled }] }) }, "org"))
      .toBe(enabled === true);
  });
  it("lê a camada da organização em org_guardrail_layers, não a distribuição", async () => {
    const chamadas: Array<{ sql: string; values: unknown[] }> = [];
    await comercialExigeHumano({ query: async (sql, values) => { chamadas.push({ sql, values }); return { rows: [] }; } }, "org");
    expect(chamadas[0]?.sql).toMatch(/from org_guardrail_layers/);
    expect(chamadas[0]?.values).toEqual(["org", "restricao_comercial"]);
  });
  // A trava de SAÍDA (#3270, defeito 3): só barra envio, então pega o que a
  // entrada deixa passar de propósito.
  const SO_NA_SAIDA = ["O total é 299.90 BRL", "EUR 40", "Total: 299.90 USD", "O valor é 300",
    "Por 299.90 você leva", "Leva por 299.90", "299.90 cada", "cem euros", "R$",
    "Hay descuento", "En 3 cuotas", "Cuesta 40", "The price is 30", "It costs 40", "We have a discount"];
  it.each(SO_NA_SAIDA)("a saída barra o que a entrada deixa passar: %s", s => {
    expect(contemAssuntoComercialRestrito(s)).toBe(false);
    expect(contemAssuntoComercialNaSaida(s)).toBe(true);
  });
  it.each(["trezentos reais", "Fica R$ 250,00 em 3x", "Pagamento à vista", "Pode pagar no boleto ou pix",
    "Qual o preço?", "Tem desconto?", "Em 3 parcelas"])
    ("a saída pega tudo que a entrada pega: %s", s => expect(contemAssuntoComercialNaSaida(s)).toBe(true));
  // Número sozinho e data/hora com ponto continuam fora também na saída.
  it.each(["Rua das Flores, 2054", "Sala 01", "(11) 4000-0000", "Abre às 8:30?", "dia 15.10 às 14.30",
    "Abrimos às 9.00", "Tome 1 comprimido 2x ao dia", "Estou com 40% de visão", "15/10 às 14:30",
    "Seu horário ficou para 14.30, combinado?", "Temos 3 unidades"])
    ("a saída não confunde rotina com preço: %s", s => expect(contemAssuntoComercialNaSaida(s)).toBe(false));
});
