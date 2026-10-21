/**
 * Teste unitário dos motivos de `validarFixosDaReceita` (sem MySQL e sem rede).
 *
 * Prova o que a tela precisa: o motivo do Zod vem pelo CAMINHO INTEIRO do
 * campo que falhou ("taxonomias.bairro.taxonomia", "situacao.campo"), e não
 * pelo último pedaço ("taxonomia", "campo"). Com o pedaço, dois campos
 * diferentes caíam no mesmo rótulo na tela — e ninguém sabia o que corrigir.
 */
import { describe, expect, it } from "vitest";

import { ErroDeFixosInvalidos, validarFixosDaReceita } from "./instancias";

/** Os "fixos" que passam, para o teste mexer só no que quer testar. */
const FIXOS_OK = {
  prefixo: "wp_",
  post_type: "imovel",
  campos: { preco: "preco" },
};

/** Valida e devolve os motivos por caminho (ou falha o teste se não lançar). */
function motivosDe(fixos: unknown): Record<string, string[]> {
  try {
    validarFixosDaReceita("acf-imoveis", fixos);
  } catch (err) {
    expect(err, "validarFixosDaReceita não lançou").toBeInstanceOf(ErroDeFixosInvalidos);
    return (err as ErroDeFixosInvalidos).fieldErrors;
  }
  throw new Error("validarFixosDaReceita devia ter lançado (o Zod recusou)");
}

describe("validarFixosDaReceita — o motivo vem pelo caminho inteiro", () => {
  it("o slug inválido da categoria do bairro vem em taxonomias.bairro.taxonomia", () => {
    const motivos = motivosDe({
      ...FIXOS_OK,
      taxonomias: { bairro: { taxonomia: "Localizacao" } },
    });

    expect(Object.keys(motivos)).toContain("taxonomias.bairro.taxonomia");
    expect(motivos["taxonomias.bairro.taxonomia"]?.[0]).toContain("nome da categoria");
    // E o pedaço sozinho NÃO aparece: ele não diz onde falhou.
    expect(motivos["taxonomia"]).toBeUndefined();
  });

  it("o campo da situação vem em situacao.campo, e os valores em situacao.ocultar", () => {
    const campo = motivosDe({
      ...FIXOS_OK,
      situacao: { campo: "situação do imóvel", ocultar: ["vendido"] },
    });
    expect(Object.keys(campo)).toContain("situacao.campo");
    expect(campo["situacao.campo"]?.[0]).toContain("nome do campo");

    const ocultar = motivosDe({
      ...FIXOS_OK,
      situacao: { campo: "situacao", ocultar: [] },
    });
    expect(Object.keys(ocultar)).toContain("situacao.ocultar");
    expect(ocultar["situacao.ocultar"]?.[0]).toContain("pelo menos um valor");
  });

  it("o mesmo dado em campo e em categoria vem em taxonomias.bairro", () => {
    const motivos = motivosDe({
      ...FIXOS_OK,
      campos: { preco: "preco", bairro: "bairro" },
      taxonomias: { bairro: { taxonomia: "localizacao" } },
    });

    expect(Object.keys(motivos)).toContain("taxonomias.bairro");
    expect(motivos["taxonomias.bairro"]?.[0]).toContain("campo ou categoria");
  });

  it("sem preço e sem aluguel o motivo vem em campos", () => {
    const motivos = motivosDe({
      prefixo: "wp_",
      post_type: "imovel",
      campos: { quartos: "quartos" },
    });

    expect(Object.keys(motivos)).toContain("campos");
    expect(motivos["campos"]?.[0]).toContain("preço de venda");
  });

  it("a mensagem de erro crua leva o caminho (para o log de quem lê o erro)", () => {
    try {
      validarFixosDaReceita("acf-imoveis", {
        ...FIXOS_OK,
        situacao: { campo: "situação do imóvel", ocultar: ["vendido"] },
      });
      throw new Error("devia ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(ErroDeFixosInvalidos);
      expect((err as Error).message).toContain("fixos_invalidos:acf-imoveis");
      expect((err as Error).message).toContain("situacao.campo");
    }
  });
});
