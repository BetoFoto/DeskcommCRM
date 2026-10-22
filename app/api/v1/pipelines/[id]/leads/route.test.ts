/**
 * A LISTA DO FUNIL PAGINADA NO BANCO (#3172, fatia 1).
 *
 * ─── O que este arquivo mede, e por quê ─────────────────────────────────────
 *
 * O defeito da issue não é visual: é a LEITURA. `GET …/board` lê o funil
 * inteiro, e num funil migrado com milhares de negócios isso levou 19 s (cada
 * linha passa por `fn_can_view_lead`), até estourar o `statement_timeout` do
 * papel `authenticated`. A rota nova lê UMA página com `range`.
 *
 * Por isso o caso que importa aqui é o da PÁGINA 2: ele é o único que distingue
 * "leu a página pedida" de "leu o funil inteiro e devolveu o pedaço que deu".
 * Uma rota sem `range` (a sabotagem que a issue pede) passa em todos os casos de
 * página 1 e cai exatamente neste.
 *
 * O dublê de banco (`tests/helpers/stages-db-double`) aplica `eq`/`neq`,
 * `order`, `range` e `count` de verdade: um stub de linha fixa mediria o stub,
 * não o handler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { ORG_ID, PIPE, authOk, makeDb, type LeadRow } from "@/tests/helpers/stages-db-double";

const OUTRO_PIPE = "77777777-7777-4777-8777-777777777777";

const ctx = (id: string = PIPE) => ({ params: Promise.resolve({ id }) });

const requisicao = (qs = "", id: string = PIPE) =>
  new NextRequest(`http://localhost/api/v1/pipelines/${id}/leads${qs}`);

/**
 * Um negócio de `crm_leads` com os campos que a LISTA lê — `position_in_stage`
 * (a ordem do quadro) e `status` (o arquivado que fica fora).
 *
 * O `LeadRow` do dublê declara só o que as rotas de etapa e quadro leem; o
 * `as unknown as` é o cast declarado do resto das colunas, e não um alívio de
 * tipo: sem ele o teste não poderia montar o funil que a lista existe para ler.
 */
function daLista(id: string, over: Record<string, unknown> = {}): LeadRow {
  return {
    id,
    stage_id: "e1",
    pipeline_id: PIPE,
    organization_id: ORG_ID,
    contact_id: null,
    position_in_stage: 0,
    status: "open",
    title: id,
    ...over,
  } as unknown as LeadRow;
}

/**
 * Cinco negócios em posições distintas — a ordem do quadro. Posições distintas
 * de propósito: em empate, o dublê (e o Postgres sem desempate) não promete
 * ordem, e um teste sobre qual item cai em qual página mediria o acaso.
 */
const CINCO: LeadRow[] = [
  daLista("l1", { position_in_stage: 10, title: "Um" }),
  daLista("l2", { position_in_stage: 20, title: "Dois" }),
  daLista("l3", { position_in_stage: 30, title: "Três" }),
  daLista("l4", { position_in_stage: 40, title: "Quatro" }),
  daLista("l5", { position_in_stage: 50, title: "Cinco" }),
];

/** O corpo do envelope de sucesso, já lido. */
async function corpo(res: Response) {
  return (await res.json()) as {
    data: Array<{ id: string }>;
    meta?: { page: number; per_page: number; total: number; has_more: boolean };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/pipelines/[id]/leads", () => {
  it("exige viewer — ler a lista é a mesma permissão de abrir o quadro", async () => {
    authOk();
    makeDb({ leads: CINCO });
    const { GET } = await import("./route");
    await GET(requisicao(), ctx());
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("viewer");
  });

  it("sem auth → repassa a resposta do portão, sem ler o banco", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("unauthenticated", "Auth required.", 401, {}),
    });
    const db = makeDb({ leads: CINCO });
    const { GET } = await import("./route");
    const res = await GET(requisicao("?page=2&per_page=2"), ctx());
    expect(res.status).toBe(401);
    expect(db.escritas).toEqual([]);
  });

  it("⭐ a PÁGINA 2 devolve só os itens dela, e o `meta` diz que há mais", async () => {
    authOk();
    makeDb({ leads: CINCO });
    const { GET } = await import("./route");

    const { data, meta } = await corpo(await GET(requisicao("?page=2&per_page=2"), ctx()));

    // Sem `range` na consulta, é aqui que o teste cai: o funil inteiro volta.
    expect(data.map((l) => l.id)).toEqual(["l3", "l4"]);
    expect(meta).toEqual({ page: 2, per_page: 2, total: 5, has_more: true });
  });

  it("a ÚLTIMA página não promete próxima", async () => {
    authOk();
    makeDb({ leads: CINCO });
    const { GET } = await import("./route");

    const { data, meta } = await corpo(await GET(requisicao("?page=3&per_page=2"), ctx()));

    expect(data.map((l) => l.id)).toEqual(["l5"]);
    expect(meta?.has_more).toBe(false);
  });

  it("página cheia na última fatia NÃO tem próxima — o teto é a contagem", async () => {
    authOk();
    makeDb({ leads: CINCO });
    const { GET } = await import("./route");

    const res = await GET(requisicao("?page=1&per_page=5"), ctx());
    const { data, meta } = await corpo(res);

    expect(data).toHaveLength(5);
    expect(meta).toEqual({ page: 1, per_page: 5, total: 5, has_more: false });
  });

  it("a ordem é a do quadro (`position_in_stage`)", async () => {
    authOk();
    // Fora de ordem no banco: com o `.order` apagado, a página sairia embaralhada.
    makeDb({ leads: [CINCO[2]!, CINCO[0]!, CINCO[4]!, CINCO[1]!, CINCO[3]!] });
    const { GET } = await import("./route");

    const { data } = await corpo(await GET(requisicao("?page=1&per_page=10"), ctx()));

    expect(data.map((l) => l.id)).toEqual(["l1", "l2", "l3", "l4", "l5"]);
  });

  it("negócio arquivado e negócio de OUTRO funil ficam fora — e da contagem também", async () => {
    authOk();
    makeDb({
      leads: [
        CINCO[0]!,
        daLista("arq", { position_in_stage: 60, status: "archived" }),
        daLista("outro", { position_in_stage: 70, pipeline_id: OUTRO_PIPE }),
      ],
    });
    const { GET } = await import("./route");

    const { data, meta } = await corpo(await GET(requisicao("?page=1&per_page=10"), ctx()));

    expect(data.map((l) => l.id)).toEqual(["l1"]);
    expect(meta?.total).toBe(1);
  });

  it("`per_page` acima do teto é o TETO, não um 422: a lista inteira não se perde por isso", async () => {
    authOk();
    makeDb({ leads: CINCO });
    const { GET } = await import("./route");

    const { meta } = await corpo(await GET(requisicao("?per_page=5000"), ctx()));

    expect(meta?.per_page).toBe(200);
  });

  it("`page` inválida (`0`, `abc`) cai na 1 — a resposta não mente sobre a pergunta", async () => {
    authOk();
    makeDb({ leads: CINCO });
    const { GET } = await import("./route");

    for (const invalida of ["0", "abc", "-3"]) {
      const { meta } = await corpo(await GET(requisicao(`?page=${invalida}`), ctx()));
      expect(meta?.page).toBe(1);
    }
  });

  it("funil de outra organização (ou inexistente) → 404, e não lista vazia", async () => {
    authOk();
    // A linha existe, mas é de OUTRA organização: o `eq("organization_id")` é
    // quem separa — sem ele, um id alheio vazaria os negócios do outro tenant.
    makeDb({
      pipelines: [
        {
          id: OUTRO_PIPE,
          name: "Alheio",
          slug: "alheio",
          description: null,
          position: 1000,
          is_default: false,
          is_archived: false,
          organization_id: "99999999-9999-4999-8999-999999999999",
        },
      ],
      leads: CINCO,
    });
    const { GET } = await import("./route");

    const res = await GET(requisicao("", OUTRO_PIPE), ctx(OUTRO_PIPE));

    expect(res.status).toBe(404);
  });

  it("erro de leitura do banco → 500, nunca `data: []` (lista vazia seria mentira)", async () => {
    authOk();
    makeDb({
      leads: CINCO,
      readError: (table) =>
        table === "crm_leads" ? { code: "XX000", message: "banco caiu" } : null,
    });
    const { GET } = await import("./route");

    const res = await GET(requisicao("?page=1&per_page=2"), ctx());

    expect(res.status).toBe(500);
  });
});

describe("o isolamento por organização, medido nos filtros emitidos", () => {
  it("o `organization_id` vai na leitura do funil E na dos negócios", async () => {
    authOk();
    // `readError` devolvendo `null` não é erro: é a única janela para ver os
    // filtros que a rota emitiu. Sem `eq("organization_id")` na consulta de
    // `crm_leads`, um id de funil alheio listaria negócios de outro tenant.
    const vistos: Record<string, Array<Array<[string, unknown]>>> = {};
    makeDb({
      leads: CINCO,
      readError: (table, filtros) => {
        (vistos[table] ??= []).push(filtros);
        return null;
      },
    });
    const { GET } = await import("./route");

    await GET(requisicao("?page=1&per_page=2"), ctx());

    expect(vistos.crm_pipelines?.[0]).toContainEqual(["organization_id", ORG_ID]);
    expect(vistos.crm_leads?.[0]).toContainEqual(["organization_id", ORG_ID]);
    expect(vistos.crm_leads?.[0]).toContainEqual(["pipeline_id", PIPE]);
  });

  it("funil com o id certo mas de outra organização → 404", async () => {
    authOk();
    makeDb({
      pipelines: [
        {
          id: PIPE,
          name: "Do vizinho",
          slug: "vizinho",
          description: null,
          position: 1000,
          is_default: false,
          is_archived: false,
          organization_id: "99999999-9999-4999-8999-999999999999",
        },
      ],
      leads: CINCO,
    });
    const { GET } = await import("./route");

    const res = await GET(requisicao(), ctx(PIPE));

    expect(res.status).toBe(404);
  });
});
