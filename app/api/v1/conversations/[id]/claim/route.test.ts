import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { createClient } from "@/lib/supabase/server";

import { POST } from "./route";

/**
 * POST /api/v1/conversations/[id]/claim — assumir a conversa assume o negócio
 * ABERTO do contato (#3177, sugestão 1 da issue: "ao transferir OU assumir").
 *
 * Aqui o portão de permissão é generoso por construção: o dono novo do card é
 * quem está assumindo (`to_user_id = user.id`), e um negócio SEM dono é visível
 * a todo `agent` nos três `visibility_mode`. Ou seja, o caso comum — card
 * largado no funil, atendente assume a conversa — passa pela RLS sem atalho
 * nenhum. O cliente continua sendo o da SESSÃO; service-role não entra aqui.
 */

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "aaaaaaaa-3333-4000-8000-000000000003";
const CONV_A = "aaaaaaaa-1111-4000-8000-000000000001";
const CONTATO_A = "aaaaaaaa-5555-4000-8000-000000000009";
const LEAD_ABERTO = "aaaaaaaa-7777-4000-8000-000000000001";

type Linha = Record<string, unknown>;

interface Estado {
  leads: Linha[];
  rpcs: Array<{ nome: string; params: Linha }>;
  escritasDeLead: Linha[];
  /** Tabelas tocadas pelo cliente de SESSÃO. */
  tabelasDaSessao: string[];
}

function lead(id: string, status: string, owner: string | null): Linha {
  return {
    id,
    organization_id: ORG_A,
    contact_id: CONTATO_A,
    status,
    owner_user_id: owner,
    owner_agent_id: null,
    owner_kind: owner ? "user" : null,
    assigned_at: "2026-01-01T00:00:00.000Z",
  };
}

function clienteFalso(estado: Estado) {
  function builder(tabela: string) {
    estado.tabelasDaSessao.push(tabela);
    const filtros: Array<[string, unknown]> = [];
    let patch: Linha | null = null;
    const linhas = () => (tabela === "crm_leads" ? estado.leads : []);
    const casa = (l: Linha) => filtros.every(([c, v]) => l[c] === v);
    const q = {
      select: () => q,
      update: (v: Linha) => {
        patch = v;
        return q;
      },
      eq: (c: string, v: unknown) => {
        filtros.push([c, v]);
        return q;
      },
      limit: () => q,
      maybeSingle: async () => {
        if (patch) {
          const alvos = linhas().filter(casa);
          if (alvos.length > 0) estado.escritasDeLead.push({ ...patch });
          for (const l of alvos) Object.assign(l, patch);
          patch = null;
          return { data: alvos[0] ?? null, error: null };
        }
        return { data: linhas().find(casa) ?? null, error: null };
      },
      then: (comOk: (v: unknown) => unknown, comErro: (e: unknown) => unknown) =>
        Promise.resolve({ data: linhas().filter(casa), error: null }).then(comOk, comErro),
    };
    return q;
  }
  return {
    from: builder,
    rpc: async (nome: string, params: Linha) => {
      estado.rpcs.push({ nome, params });
      if (nome === "fn_conversation_assign") {
        return {
          data: [
            {
              id: CONV_A,
              organization_id: ORG_A,
              contact_id: CONTATO_A,
              status: "open",
              assigned_to_user_id: params.p_to_user_id,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
}

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(() => ({
    ok: true,
    user: { id: "aaaaaaaa-3333-4000-8000-000000000003", idioma: "pt-BR" },
    org: { orgId: "aaaaaaaa-0000-4000-8000-000000000001", role: "agent" },
  })),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/inbox/atividade-de-comando", () => ({
  registrarTrocaDeComando: vi.fn(async () => {}),
}));

let estado: Estado;

beforeEach(() => {
  vi.clearAllMocks();
  estado = {
    leads: [lead(LEAD_ABERTO, "open", null)],
    rpcs: [],
    escritasDeLead: [],
    tabelasDaSessao: [],
  };
  vi.mocked(createClient).mockResolvedValue(clienteFalso(estado) as unknown as SupabaseClient);
  vi.mocked(requireSupportWrite).mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof requireSupportWrite>>,
  );
});

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/v1/conversations/${CONV_A}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

const params = { params: Promise.resolve({ id: CONV_A }) };

describe("POST /api/v1/conversations/[id]/claim — o negócio aberto segue (#3177)", () => {
  it("assumir aplica o responsável ao negócio ABERTO e sem dono do contato", async () => {
    const res = await POST(req(), params);

    expect(res.status).toBe(200);
    expect(estado.leads[0]).toMatchObject({
      owner_user_id: USER,
      owner_agent_id: null,
      owner_kind: "user",
    });
    expect(estado.escritasDeLead).toHaveLength(1);
    expect(estado.tabelasDaSessao).toContain("crm_leads");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "conversation.claimed",
        metadata: expect.objectContaining({ negocio_aberto: "sincronizado" }),
      }),
    );
  });

  it("CONTROLE: sem negócio aberto, assumir não cria card nenhum", async () => {
    estado.leads = [lead("aaaaaaaa-7777-4000-8000-000000000002", "lost", null)];

    const res = await POST(req(), params);

    expect(res.status).toBe(200);
    expect(estado.leads).toHaveLength(1);
    expect(estado.leads[0]).toMatchObject({ status: "lost", owner_user_id: null });
    expect(estado.escritasDeLead).toHaveLength(0);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ negocio_aberto: "sem_negocio_aberto" }),
      }),
    );
  });

  it("CONTROLE: o card de quem JÁ é o responsável não é regravado", async () => {
    estado.leads = [lead(LEAD_ABERTO, "open", USER)];

    const res = await POST(req(), params);

    expect(res.status).toBe(200);
    expect(estado.escritasDeLead).toHaveLength(0);
    expect(estado.leads[0].assigned_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("a rota de assumir não inventa evento de automação novo", async () => {
    await POST(req(), params);

    const eventos = estado.rpcs
      .filter((r) => r.nome === "emit_event")
      .map((r) => r.params.p_event_type);
    expect(eventos).toEqual(["conversation.claimed"]);
    expect(eventos).not.toContain("conversation.assigned");
    expect(registrarTrocaDeComando).toHaveBeenCalledTimes(1);
  });
});
