import { describe, expect, it } from "vitest";

import {
  gerarHtmlDoFormulario,
  normalizarCamposNumericos,
  normalizarMoedaBRLDeFormulario,
  normalizarNumeroDeFormulario,
  webhookFormFieldsSchema,
} from "@/lib/webhooks/formulario";

describe("campos numéricos de formulário webhook", () => {
  it("aceita os tipos número e moeda no schema", () => {
    expect(
      webhookFormFieldsSchema.safeParse([
        { key: "quantidade", label: "Quantidade", type: "number", required: false },
        { key: "faturamento", label: "Faturamento", type: "currency", required: false },
      ]).success,
    ).toBe(true);
  });

  it("gera entrada numérica sem texto e campo de moeda com teclado decimal e BRL", () => {
    const html = gerarHtmlDoFormulario(
      "https://crm.example/api/v1/webhooks/in/token",
      [
        { key: "quantidade", label: "Quantidade", type: "number", required: true },
        { key: "faturamento", label: "Faturamento", type: "currency", required: false },
      ],
      { nome: "Nome", telefone: "Telefone", email: "E-mail", enviar: "Enviar", selecione: "Selecione" },
    );
    expect(html).toContain('name="quantidade" type="text" inputmode="decimal" pattern="[0-9]+([.][0-9]+)?"');
    expect(html).toContain('data-deskcomm-number="true" required');
    expect(html).toContain('name="faturamento" type="text" inputmode="decimal"');
    expect(html).toContain("currency: 'BRL'");
  });

  it.each([
    ["42", { ok: true, value: 42 }],
    ["3.5", { ok: true, value: 3.5 }],
    ["12abc", { ok: false }],
    ["1,5", { ok: false }],
  ])("valida número simples %s", (input, expected) => {
    expect(normalizarNumeroDeFormulario(input)).toEqual(expected);
  });

  it.each([
    ["R$ 1.250,00", { ok: true, value: 1250 }],
    ["10.000,50", { ok: true, value: 10000.5 }],
    ["1250", { ok: true, value: 1250 }],
    ["R$ 1.2x0,00", { ok: false }],
  ])("normaliza moeda BRL %s", (input, expected) => {
    expect(normalizarMoedaBRLDeFormulario(input)).toEqual(expected);
  });

  it("normaliza campos tipados por chave e rejeita letras", () => {
    const fields = [
      { key: "quantidade", label: "Quantidade", type: "number" as const, required: false },
      { key: "faturamento", label: "Faturamento", type: "currency" as const, required: false },
    ];
    expect(normalizarCamposNumericos({ quantidade: "12", faturamento: "R$ 1.250,00" }, fields)).toEqual({
      values: { quantidade: 12, faturamento: 1250 },
      invalidKeys: [],
    });
    expect(normalizarCamposNumericos({ quantidade: "12x" }, fields)).toEqual({
      values: {},
      invalidKeys: ["quantidade"],
    });
  });
});
