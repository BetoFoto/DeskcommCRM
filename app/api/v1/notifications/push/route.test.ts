/**
 * DELETE /api/v1/notifications/push — remove a inscrição deste aparelho e
 * audita quando removeu (sem efeito, sem auditoria).
 *
 * Roda com: npx vitest run app/api/v1/notifications/push/route.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "22222222-2222-4222-8222-222222222222";
const estado = vi.hoisted(() => ({
  removidas: [] as Array<{ organization_id: string }>,
  filtros: [] as Array<[string, unknown]>,
  audit: vi.fn(),
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: "u-ana", idioma: "pt-BR" },
    org: { orgId: ORG, role: "agent" },
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: estado.audit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q = {
        delete: () => q,
        eq: (c: string, v: unknown) => {
          estado.filtros.push([c, v]);
          return q;
        },
        select: async () => ({ data: estado.removidas, error: null }),
      };
      return q;
    },
  }),
}));

const telaBloqueada = vi.hoisted(() => ({ ler: vi.fn(async () => ({ modo: "nome", idioma: "pt-BR" })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/lib/notifications/tela-bloqueada", () => ({ lerTelaBloqueada: telaBloqueada.ler }));

import { DELETE, GET } from "./route";

function pedido(corpo: unknown) {
  return new NextRequest("http://localhost/api/v1/notifications/push", {
    method: "DELETE",
    body: JSON.stringify(corpo),
  });
}

beforeEach(() => {
  estado.removidas = [];
  estado.filtros = [];
  estado.audit.mockReset();
});

describe("DELETE /api/v1/notifications/push", () => {
  it("removeu a inscrição → 200 e auditoria com a organização da linha", async () => {
    estado.removidas = [{ organization_id: ORG }];
    const res = await DELETE(pedido({ endpoint: "https://push/1" }));
    expect(res.status).toBe(200);
    expect(estado.filtros).toEqual([
      ["endpoint", "https://push/1"],
      ["user_id", "u-ana"],
    ]);
    expect(estado.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification_prefs.push_subscription_removed",
        actorUserId: "u-ana",
        organizationId: ORG,
        resourceType: "push_subscription",
        metadata: { channel: "web_push", escopo: "aparelho" },
      }),
    );
  });

  it("nada removido → 200 sem auditoria", async () => {
    const res = await DELETE(pedido({ endpoint: "https://push/1" }));
    expect(res.status).toBe(200);
    expect(estado.audit).not.toHaveBeenCalled();
  });

  it("corpo inválido → 422, sem tocar no banco", async () => {
    const res = await DELETE(pedido({ endpoint: "nao-e-url" }));
    expect(res.status).toBe(422);
    expect(estado.filtros).toEqual([]);
  });
});

describe("GET /api/v1/notifications/push", () => {
  // A bandeja do app aberto aplica a mesma opção que o funil do servidor.
  it("devolve a opção da tela bloqueada da organização ativa", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { conteudo: string } };
    expect(json.data.conteudo).toBe("nome");
    expect(telaBloqueada.ler).toHaveBeenCalledWith({ admin: true }, ORG);
  });
});
