import { describe, expect, it } from "vitest";

import { oQueOHubMostra } from "./hub";

describe("o que o hub da conta suspensa mostra", () => {
  it.each([
    [{ administra: true, tipo: "cobranca", cobrancaLigada: true, temAssinatura: true }, "pagamento"],
    [{ administra: false, tipo: "cobranca", cobrancaLigada: true, temAssinatura: true }, "avise_o_admin"],
    [{ administra: true, tipo: "administrativa", cobrancaLigada: true, temAssinatura: true }, "contato"],
    [{ administra: true, tipo: "cobranca", cobrancaLigada: false, temAssinatura: true }, "contato"],
    [{ administra: true, tipo: "cobranca", cobrancaLigada: true, temAssinatura: false }, "contato"],
    [{ administra: false, tipo: "administrativa", cobrancaLigada: false, temAssinatura: false }, "avise_o_admin"],
  ] as const)("%j → %s", (entrada, esperado) => {
    expect(oQueOHubMostra(entrada)).toBe(esperado);
  });
});
