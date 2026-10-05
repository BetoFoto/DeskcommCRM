import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * Exclusão de tenant e suspensão por cobrança (migration 0556).
 *
 * EXCLUIR NÃO APAGA QUEM DEVE. Uma organização suspensa por COBRANÇA não se
 * exclui: a assinatura continuaria cobrando no provedor e ninguém mais teria
 * onde resolver. A rota confere o tipo antes de tocar em nada, e a função
 * confere de novo dentro da transação — `fn_suspender_organizacao` pode trocar
 * o tipo entre a leitura da rota e a exclusão. Este arquivo prova a segunda.
 *
 * O AVISO DE TROCA DE E-MAIL CABE NA CENTRAL. A rota de troca do e-mail de
 * login grava `email_de_login_trocado` em `agent_inbox_items`; sem o kind no
 * CHECK, a troca falharia fechada em toda instalação.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG_COBRANCA = "7e0b0000-0000-4000-8000-0000000000c0";
const ORG_AVISO = "7e0b0000-0000-4000-8000-0000000000a0";
const ATOR = "7e0b1111-0000-4000-8000-0000000000ff";
const SLUG = "exclusao-recusa-cobranca";
const MOTIVO = "motivo suficientemente longo";

beforeAll(async () => {
  for (const [id, slug] of [
    [ORG_COBRANCA, SLUG],
    [ORG_AVISO, "exclusao-recusa-cobranca-aviso"],
  ] as const) {
    await pool.query(
      `insert into organizations (id, slug, legal_name, display_name)
       values ($1, $2, $3, $3) on conflict (id) do nothing`,
      [id, slug, `Exclusão ${slug}`],
    );
  }
  // Como o service role prepara: o gatilho da 0501 só barra authenticated/anon.
  await pool.query(
    `update organizations set status = 'suspended', suspended_kind = 'cobranca',
            suspended_at = now(), suspended_reason = 'cobrança em aberto'
      where id = $1`,
    [ORG_COBRANCA],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = any($1)", [[ORG_COBRANCA, ORG_AVISO]]);
  await pool.query("delete from api_audit_log where resource_id = $1", [ORG_COBRANCA]);
  await pool.end();
});

describe("fn_excluir_organizacao recusa suspensão por cobrança", () => {
  it("controle: a organização está suspensa por cobrança", async () => {
    const { rows } = await pool.query<{ status: string; suspended_kind: string }>(
      "select status, suspended_kind from organizations where id = $1",
      [ORG_COBRANCA],
    );
    expect(rows[0]).toEqual({ status: "suspended", suspended_kind: "cobranca" });
  });

  it("PT409 organizacao_com_cobranca_pendente, e a organização continua lá", async () => {
    let erro: { code?: string; message?: string } | null = null;
    try {
      await pool.query("select public.fn_excluir_organizacao($1, $2, $3, $4)", [
        ORG_COBRANCA,
        ATOR,
        SLUG,
        MOTIVO,
      ]);
    } catch (e) {
      erro = e as { code?: string; message?: string };
    }
    expect(erro?.code).toBe("PT409");
    expect(erro?.message).toBe("organizacao_com_cobranca_pendente");

    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from organizations where id = $1",
      [ORG_COBRANCA],
    );
    expect(Number(rows[0]!.n)).toBe(1);
    const lapide = await pool.query(
      "select 1 from api_audit_log where action = 'organization.deleted' and resource_id = $1",
      [ORG_COBRANCA],
    );
    expect(lapide.rowCount).toBe(0);
  });
});

describe("agent_inbox_items aceita email_de_login_trocado", () => {
  it("o insert que a rota de troca de e-mail faz passa pelo CHECK", async () => {
    const { rows } = await pool.query<{ kind: string }>(
      `insert into agent_inbox_items (organization_id, kind, severity, title, body)
       values ($1, 'email_de_login_trocado', 'warn',
               'E-mail de login trocado pelo administrador da plataforma',
               'O e-mail de login de uma pessoa da equipe foi trocado.')
       returning kind`,
      [ORG_AVISO],
    );
    expect(rows[0]!.kind).toBe("email_de_login_trocado");
  });

  it("controle: um kind fora do vocabulário continua recusado", async () => {
    await expect(
      pool.query(
        `insert into agent_inbox_items (organization_id, kind, title) values ($1, 'kind_inexistente', 't')`,
        [ORG_AVISO],
      ),
    ).rejects.toThrow(/agent_inbox_items_kind_check/);
  });
});
