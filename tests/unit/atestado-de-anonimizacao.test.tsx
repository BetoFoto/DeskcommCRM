/**
 * O ATESTADO DE ANONIMIZAÇÃO — o que o PAPEL declara, e o que ele se recusa a declarar.
 *
 * ─── O que cada caso fecha ──────────────────────────────────────────────────
 *
 * O pedido de exclusão precisa de um documento que o titular guarde: quem fez,
 * quando, de onde e um código que amarre o conjunto. O que este arquivo mede é
 * o documento DE VERDADE — o componente é chamado e os textos são colhidos da
 * árvore (`textos`, a mesma técnica de `art-15-entregue-no-pdf`) —, e não um
 * resumo do que ele deveria dizer.
 *
 * Os casos que importam são os NEGATIVOS, porque é neles que um documento deste
 * tipo costuma errar: (1) o documento NÃO pode inventar artigo de lei — a
 * citação entra pelo perfil do país, e país sem citação revisada não cita nada;
 * (2) NÃO pode imprimir o número inteiro do titular nem o endereço inteiro, já
 * que circula por e-mail e pode ser encaminhado; (3) NÃO pode inventar um
 * responsável quando a execução foi automática; (4) NÃO pode exibir o mesmo
 * selo para HMAC (prova origem) e SHA-256 (prova só integridade).
 */
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  VERSAO_DO_ATESTADO,
  codigoCurto,
  codigoDeAutenticidade,
  evidenciaDoPedido,
  linhaCanonica,
  textoDaDeclaracao,
  type DadosDoAtestado,
} from "@/lib/lgpd/atestado-de-anonimizacao";
import { AtestadoDeAnonimizacaoPdf } from "@/lib/lgpd/atestado-renderer";

function textos(no: ReactNode): string[] {
  if (no === null || no === undefined || typeof no === "boolean") return [];
  if (typeof no === "string") return [no];
  if (typeof no === "number") return [String(no)];
  if (Array.isArray(no)) return no.flatMap(textos);
  const el = no as ReactElement<{ children?: ReactNode }>;
  if (el.props && "children" in el.props) return textos(el.props.children);
  return [];
}

function dados(over: Partial<DadosDoAtestado> = {}): DadosDoAtestado {
  return {
    request_id: "11111111-2222-3333-4444-555555555555",
    organization_id: "org-1",
    organization_name: "Loja Exemplo LTDA",
    organization_document: "12.345.678/0001-90",
    organization_email: "dpo@loja.exemplo",
    titular: {
      nome: "Maria Souza",
      documento: "***.***.***-45",
      rotuloDoDocumento: "CPF",
      email: "m***@exemplo.com",
      telefone: "(**) ****-1234",
      documentoNoCadastro: false,
    },
    evidencia: {
      executor: { user_id: "u1", nome: "Ana Lima", email: "ana@loja.exemplo", papel: "administrador" },
      ip: "203.0.113.7",
      user_agent: "Mozilla/5.0",
      em: "2026-10-22T15:04:05.000Z",
      origem: "aprovacao_manual",
    },
    escopo: "contact",
    fuso: "America/Sao_Paulo",
    lei_rotulo: "Base legal",
    lei_citada: "RGPD art. 12.º, n.º 3",
    ...over,
  };
}

/** O papel montado, com espaços colapsados. */
function papel(
  d: DadosDoAtestado,
  codigo = "A1B2-C3D4-E5F6-7890",
  algoritmo: "hmac-sha256" | "sha256" = "hmac-sha256",
): string {
  return textos(AtestadoDeAnonimizacaoPdf({ dados: d, codigo, algoritmo })).join(" ").replace(/\s+/g, " ");
}

describe("o papel declara o que o pedido precisa provar", () => {
  it("identifica o controlador, o requerente, o ato datado e o código", () => {
    const p = papel(dados());

    expect(p).toContain("Atestado de Anonimização de Dados Pessoais");
    // O CONTROLADOR responde pelos dados — e o CNPJ dele sai inteiro (dado
    // público de empresa; é ele que diz de quem é o documento).
    expect(p).toContain("Loja Exemplo LTDA");
    expect(p).toContain("12.345.678/0001-90");
    expect(p).toContain("dpo@loja.exemplo");
    // O requerente, identificado — e mascarado.
    expect(p).toContain("Maria Souza");
    expect(p).toContain("**");
    expect(p).toContain("m***@exemplo.com");
    expect(p).toContain("****-1234");
    // O ato: quando, quem, de onde.
    expect(p).toContain("2026-10-22T15:04:05.000Z (America/Sao_Paulo)");
    expect(p).toContain("Ana Lima");
    expect(p).toContain("203.0.113.7");
    expect(p).toContain("aprovação no painel");
    // E o que amarra tudo.
    expect(p).toContain("A1B2-C3D4-E5F6-7890");
    expect(p).toContain(VERSAO_DO_ATESTADO);
  });

  it("não imprime o endereço do titular pela metade — nem qualquer número que não tenha vindo", () => {
    const p = papel(dados());
    expect(p).not.toContain("maria@exemplo.com");
    expect(p).not.toContain("111.222.333-44");
  });

  it("país sem citação revisada: o papel DIZ que não cita, em vez de citar errado", () => {
    const p = papel(dados({ lei_citada: null }));
    expect(p).toContain("não declarada (país sem citação revisada)");
    expect(p).not.toContain("RGPD");
  });

  it("a declaração é de FATO — nenhum artigo sai daqui", () => {
    const t = textoDaDeclaracao(dados());
    expect(t).toContain("11111111-2222-3333-4444-555555555555");
    expect(t).toContain("Maria Souza");
    expect(t).toContain("203.0.113.7");
    expect(t).toContain("ANONIMIZADOS");
    expect(t).not.toMatch(/art\.|artigo|LGPD|RGPD|Lei n/i);
  });

  it("execução automática: o papel NÃO inventa responsável", () => {
    const automatica = evidenciaDoPedido(undefined, "2026-10-22T15:04:05.000Z");
    expect(automatica.origem).toBe("automatica");
    expect(automatica.executor).toBeNull();

    const p = papel(dados({ evidencia: automatica }));
    expect(p).toContain("execução automática do sistema");
    expect(p).toContain("sem ato humano (execução automática)");
    expect(p).not.toContain("Ana Lima");
  });

  it("sem documento em lugar nenhum: diz o que falta, nunca um número pela metade", () => {
    const p = papel(
      dados({
        titular: {
          nome: "Maria Souza",
          documento: null,
          rotuloDoDocumento: "CPF",
          email: null,
          telefone: null,
          documentoNoCadastro: true,
        },
      }),
    );
    expect(p).toContain("CPF informado no cadastro (não reimpresso neste documento)");
    expect(p).toContain("não informados");
  });

  it("instalação sem chave exibe INTEGRIDADE, não autenticidade", () => {
    const p = papel(dados(), "A1B2-C3D4-E5F6-7890", "sha256");
    expect(p).toContain("Código de integridade (SHA-256");
    expect(p).toContain("não prova a origem");
    expect(p).not.toContain("Código de autenticidade");
  });

  it("escopo de loja inteira muda a frase do papel — e do escopo do titular", () => {
    expect(papel(dados({ escopo: "tenant" }))).toContain("base completa da organização");
    expect(papel(dados())).toContain("dados do titular");
  });
});

describe("o código de autenticidade amarra o documento à instalação", () => {
  it("é determinístico e muda se UM campo mudar", () => {
    const a = codigoDeAutenticidade(dados(), "chave-de-assinatura-longa");
    const b = codigoDeAutenticidade(dados(), "chave-de-assinatura-longa");
    const alterado = codigoDeAutenticidade(
      dados({ titular: { ...dados().titular, nome: "Maria Souz4" } }),
      "chave-de-assinatura-longa",
    );

    expect(a.codigo).toBe(b.codigo);
    expect(a.algoritmo).toBe("hmac-sha256");
    expect(a.codigo).toMatch(/^[0-9a-f]{64}$/);
    expect(alterado.codigo).not.toBe(a.codigo);
  });

  it("instalação sem chave degrada para SHA-256 — e diz que degradou", () => {
    for (const chave of [null, "", "curta"]) {
      const r = codigoDeAutenticidade(dados(), chave);
      expect(r.algoritmo).toBe("sha256");
      expect(r.codigo).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("a linha canônica marca o ausente com `-`: ausente e vazio não geram o mesmo código", () => {
    const completo = linhaCanonica(dados());
    const semDocumento = linhaCanonica(dados({ titular: { ...dados().titular, documento: null } }));
    const documentoVazio = linhaCanonica(dados({ titular: { ...dados().titular, documento: "" } }));

    expect(completo.split("|")[0]).toBe(VERSAO_DO_ATESTADO);
    expect(semDocumento.split("|")).toContain("-");
    expect(documentoVazio).not.toBe(semDocumento);
  });

  it("o código citável é o recorte de 16 hex em quatro blocos", () => {
    expect(codigoCurto("a1b2c3d4e5f6789012345678abcdef01")).toBe("A1B2-C3D4-E5F6-7890");
  });
});

describe("a evidência vem do que o pedido guardou — nada é adivinhado", () => {
  it("evidência do ato humano: quem, de onde, quando", () => {
    const e = evidenciaDoPedido(
      {
        origem: "aprovacao_manual",
        executor: { user_id: "u9", nome: "Ana Lima", email: "ana@loja", papel: "owner" },
        ip: "198.51.100.9",
        user_agent: "Firefox",
        em: "2026-10-22T12:00:00.000Z",
      },
      "2026-10-22T13:00:00.000Z",
    );

    expect(e).toEqual({
      executor: { user_id: "u9", nome: "Ana Lima", email: "ana@loja", papel: "owner" },
      ip: "198.51.100.9",
      user_agent: "Firefox",
      em: "2026-10-22T12:00:00.000Z",
      origem: "aprovacao_manual",
    });
  });

  it("JSONB adulterado não vira linha do documento", () => {
    for (const adulterada of [
      { origem: "aprovacao_manual", executor: { nome: "" } },
      { origem: "aprovacao_manual", executor: { nome: 42 } },
      { origem: "aprovacao_manual" },
      "texto solto",
      7,
      null,
    ]) {
      const e = evidenciaDoPedido(adulterada, "2026-10-22T13:00:00.000Z");
      expect(e.origem, `aceitou evidência inválida: ${JSON.stringify(adulterada)}`).toBe("automatica");
      expect(e.em).toBe("2026-10-22T13:00:00.000Z");
    }
  });
});
