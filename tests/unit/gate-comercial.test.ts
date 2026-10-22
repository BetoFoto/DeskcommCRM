import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { runBeforeSend } from "@/lib/agent-engine/guardrails/before-send";
import type { Logger } from "@/lib/agent-engine/obs/logger";
const RESPOSTA = "Os óculos custam R$ 299,90.";
const COMERCIAL = new Date("2026-07-28T13:00:00Z"); // 10h BRT, terça — dentro da janela

function chamaCadeiaReal(args: { body: string; armado: boolean }): {
  run: ReturnType<typeof runBeforeSend>;
  inserts: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const inserts = vi.fn().mockResolvedValue({ rows: [{ id: "trace-1" }] });
  const pool = { connect: vi.fn().mockResolvedValue(client), query: inserts } as unknown as pg.Pool;
  const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const send = vi.fn(async () => ({ kind: "sent" as const, idempotencyKey: "k", messageId: "m" }));
  return {
    inserts,
    send,
    run: runBeforeSend({
      pool,
      log,
      tenantId: "00000000-0000-4000-8000-000000000001",
      leadId: "00000000-0000-4000-8000-000000000002",
      jobId: "00000000-0000-4000-8000-000000000003",
      channelSessionId: "00000000-0000-4000-8000-000000000004",
      body: args.body,
      optedOutThisTurn: false,
      crmDailyLimit: null,
      now: COMERCIAL,
      rng: () => 0,
      sleep: async () => {},
      ...(args.armado ? { enforceCommercialRestriction: true } : {}),
      send,
    }),
  };
}

describe("a cadeia REAL barra a resposta comercial — e só quando armada", () => {
  it("armada: veta no gate certo e o trace leva só as categorias", async () => {
    const { run, inserts, send } = chamaCadeiaReal({ body: RESPOSTA, armado: true });
    const r = await run;
    expect(r.status).toBe("vetoed");
    expect(send).not.toHaveBeenCalled();
    if (r.status !== "vetoed") throw new Error("inalcançável");
    expect(r.gate).toBe("commercial_restriction");
    expect(r.code).toBe("commercial_requires_human");
    expect(r.trace).toContainEqual({
      gate: "commercial_restriction",
      verdict: "veto",
      code: "commercial_requires_human",
      detail: { restricted_kind: "commercial" },
    });
    const sql = String(inserts.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/insert into before_send_traces/);
  });

  // O gate julga com a régua de SAÍDA, mais estrita que a de entrada (#3270).
  it.each(["The price is 30 dollars.", "Total: 299.90 USD", "Hay descuento hoy."])
    ("armada: barra o que só a régua de saída pega — %s", async (body) => {
      const r = await chamaCadeiaReal({ body, armado: true }).run;
      expect(r.status).toBe("vetoed");
    });

  it("DESARMADA: o MESMO corpo é enviado", async () => {
    const r = await chamaCadeiaReal({ body: RESPOSTA, armado: false }).run;
    expect(r.status).toBe("sent");
    expect(r.trace).toContainEqual({ gate: "commercial_restriction", verdict: "pass" });
  });
});

/**
 * A trava não depende de quem chama lembrar o argumento (#3270, defeito 2). O
 * follow-up (`followup-turn.ts`), o template e a pergunta do roteiro chamavam a
 * cadeia SEM `enforceCommercialRestriction`, e a ausência valia "desligada": numa
 * org que proibiu a IA de falar de preço, esses envios saíam. Agora a cadeia lê a
 * escolha da organização ela mesma, e a leitura que falha conta como LIGADA.
 */
describe("sem o argumento, a cadeia lê a restrição da organização (falha fechada)", () => {
  const ORG = "00000000-0000-4000-8000-000000000001";
  function cadeia(camada: boolean | "falha", extra: Partial<Parameters<typeof runBeforeSend>[0]> = {}) {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const leituras: unknown[][] = [];
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn(async (sql: string, values: unknown[]) => {
        if (sql.includes("org_guardrail_layers")) {
          leituras.push(values);
          if (camada === "falha") throw new Error("banco fora do ar");
          return { rows: [{ enabled: camada }] };
        }
        return { rows: [{ id: "trace-1" }] };
      }),
    } as unknown as pg.Pool;
    const send = vi.fn(async () => ({ kind: "sent" as const, idempotencyKey: "k", messageId: "m" }));
    const run = runBeforeSend({
      pool,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      tenantId: ORG,
      leadId: "00000000-0000-4000-8000-000000000002",
      jobId: "00000000-0000-4000-8000-000000000003",
      channelSessionId: "00000000-0000-4000-8000-000000000004",
      body: RESPOSTA,
      optedOutThisTurn: false,
      crmDailyLimit: null,
      now: COMERCIAL,
      rng: () => 0,
      sleep: async () => {},
      send,
      ...extra,
    });
    return { run, send, leituras };
  }

  // Os dois formatos de chamada que ficaram de fora: o do follow-up (texto fixo,
  // sem argumento algum) e o do template (`isTemplate`).
  it.each([
    ["follow-up", {}],
    ["template", { isTemplate: true }],
  ] as const)("%s com preço numa org COM a restrição: não sai", async (_caso, extra) => {
    const { run, send, leituras } = cadeia(true, extra);
    const r = await run;
    expect(r.status).toBe("vetoed");
    if (r.status === "vetoed") expect(r.code).toBe("commercial_requires_human");
    expect(send).not.toHaveBeenCalled();
    expect(leituras).toEqual([[ORG, "restricao_comercial"]]);
  });

  it.each([
    ["follow-up", {}],
    ["template", { isTemplate: true }],
  ] as const)("%s com preço numa org SEM a restrição: sai", async (_caso, extra) => {
    const { run, send } = cadeia(false, extra);
    expect((await run).status).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
  });

  it("leitura da configuração que falha: bloqueia", async () => {
    const { run, send } = cadeia("falha");
    const r = await run;
    expect(r.status).toBe("vetoed");
    if (r.status === "vetoed") expect(r.code).toBe("commercial_requires_human");
    expect(send).not.toHaveBeenCalled();
  });

  it("corpo sem cara de preço não consulta a organização", async () => {
    const { run, leituras } = cadeia("falha", { body: "Seu horário ficou para dia 15.10 às 14.30." });
    expect((await run).status).toBe("sent");
    expect(leituras).toEqual([]);
  });

  it("quem passa o argumento manda nele (compatibilidade: o aviso de escalação passa false)", async () => {
    const { run, leituras } = cadeia(true, { enforceCommercialRestriction: false });
    expect((await run).status).toBe("sent");
    expect(leituras).toEqual([]);
  });
});
