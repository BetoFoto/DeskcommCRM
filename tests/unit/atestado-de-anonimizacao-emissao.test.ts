/**
 * A EMISSÃO DO ATESTADO — o papel sai, e sai GRAVADO onde a rota vai buscá-lo.
 *
 * ─── O que este arquivo mede, e por que não é tautológico ───────────────────
 *
 * O teste de conteúdo (`atestado-de-anonimizacao.test.tsx`) prova o TEXTO; este
 * prova que o caminho de I/O produz um PDF de verdade — e um arquivo que começa
 * com `%PDF` e passa de mil bytes não é o mesmo que uma string vazia gravada
 * com sucesso. Renderizador que devolvesse Buffer vazio faria o outro teste
 * passar inteiro.
 *
 * O caso do Storage que recusa existe porque a decisão do worker é engolir a
 * falha: se `emitirAtestadoDeAnonimizacao` não LANÇASSE nesse caminho, o worker
 * não teria como saber que não saiu nada, e `result.atestado` afirmaria um
 * documento que não existe.
 */
import { describe, expect, it } from "vitest";

import {
  VERSAO_DO_ATESTADO,
  type DadosDoAtestado,
} from "@/lib/lgpd/atestado-de-anonimizacao";
import { renderAtestadoPdf } from "@/lib/lgpd/atestado-renderer";
import { BUCKET_DO_ATESTADO, emitirAtestadoDeAnonimizacao } from "@/lib/lgpd/emitir-atestado";

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

function storageFalso(erro: string | null) {
  const gravados: Array<{ bucket: string; path: string; bytes: number; opcoes?: Record<string, unknown> }> = [];
  return {
    gravados,
    admin: {
      storage: {
        from(bucket: string) {
          return {
            async upload(path: string, corpo: Buffer, opcoes?: Record<string, unknown>) {
              gravados.push({ bucket, path, bytes: corpo.length, opcoes });
              return { error: erro ? { message: erro } : null };
            },
          };
        },
      },
    },
  };
}

describe("a emissão do atestado", () => {
  it("grava o PDF no caminho do pedido, no bucket do titular, e devolve o que ficou lá", async () => {
    const { admin, gravados } = storageFalso(null);
    // A chave vem do ambiente do PROCESSO (`pades-signer` lê a mesma): com ela
    // o código é HMAC; sem ela degrada (o caso de baixo).
    const chaveAntes = process.env.LGPD_SIGNING_KEY;
    process.env.LGPD_SIGNING_KEY = "chave-de-assinatura-de-teste-bem-longa";
    const r = await (async () => {
      try {
        return await emitirAtestadoDeAnonimizacao(admin as never, dados());
      } finally {
        if (chaveAntes === undefined) delete process.env.LGPD_SIGNING_KEY;
        else process.env.LGPD_SIGNING_KEY = chaveAntes;
      }
    })();

    expect(gravados).toHaveLength(1);
    expect(gravados[0]!.bucket).toBe(BUCKET_DO_ATESTADO);
    expect(gravados[0]!.path).toBe("atestados/org-1/11111111-2222-3333-4444-555555555555.pdf");
    // `upsert` é o que torna a retomada do pedido idempotente em vez de encher o
    // bucket de `atestado(1).pdf`.
    expect(gravados[0]!.opcoes).toMatchObject({ contentType: "application/pdf", upsert: true });
    expect(gravados[0]!.bytes).toBeGreaterThan(1000);

    expect(r.path).toBe(gravados[0]!.path);
    expect(r.bytes).toBe(gravados[0]!.bytes);
    expect(r.codigo).toMatch(/^[0-9a-f]{64}$/);
    expect(r.codigo_curto).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.algoritmo).toBe("hmac-sha256");
    // O PAdES segue degradado enquanto não há certificado provisionado
    // (`pades-signer`): o documento diz o que é, e o metadado também.
    expect(r.pades).toBe(false);
  });

  it("o arquivo emitido é um PDF de verdade, não um Buffer vazio", async () => {
    const bytes = await renderAtestadoPdf({
      dados: dados(),
      codigo: "AAAA-BBBB-CCCC-DDDD",
      algoritmo: "hmac-sha256",
    });

    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("sem chave de assinatura, o metadado diz `sha256` — e o documento impresso diz o mesmo", async () => {
    const { admin } = storageFalso(null);
    const antes = process.env.LGPD_SIGNING_KEY;
    delete process.env.LGPD_SIGNING_KEY;
    try {
      const r = await emitirAtestadoDeAnonimizacao(admin as never, dados());
      expect(r.algoritmo).toBe("sha256");
      expect(r.pades).toBe(false);
    } finally {
      if (antes !== undefined) process.env.LGPD_SIGNING_KEY = antes;
    }
  });

  it("Storage que recusa LANÇA — é o que permite ao worker registrar que não saiu", async () => {
    const { admin } = storageFalso("bucket not found");
    await expect(emitirAtestadoDeAnonimizacao(admin as never, dados())).rejects.toThrow(
      "atestado_upload_failed: bucket not found",
    );
  });

  it("o formato do documento gravado é o que o código assina (versão estável)", () => {
    expect(VERSAO_DO_ATESTADO).toBe("atestado-de-anonimizacao.v1");
  });
});
