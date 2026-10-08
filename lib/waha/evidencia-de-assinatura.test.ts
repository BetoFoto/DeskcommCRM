import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { carregarEvidenciaDeAssinatura, resumirEvidencia } from "./evidencia-de-assinatura";

describe("resumirEvidencia", () => {
  it("sem entrega nenhuma não diz que o WAHA não assina", () => {
    expect(resumirEvidencia(0, 0).veredito).toBe("sem_trafego");
  });
  it("todas assinadas libera a decisão de exigir", () => {
    expect(resumirEvidencia(12, 0).veredito).toBe("todas_assinadas");
  });
  it("nenhuma assinada avisa que exigir cortaria as mensagens", () => {
    expect(resumirEvidencia(0, 5).veredito).toBe("nenhuma_assinada");
  });
  it("mistura é sinal de alguém entregando por fora do WAHA (ou de troca de segredo)", () => {
    expect(resumirEvidencia(3, 1).veredito).toBe("misto");
  });
});

type Resposta = { count: number | null; error: { message: string } | null };

function adminFalso(porAssinatura: Record<"true" | "false", Resposta>) {
  const filtros: Array<[string, unknown]> = [];
  const admin = {
    from: (tabela: string) => {
      filtros.push(["from", tabela]);
      let assinada: boolean | null = null;
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filtros.push([col, v]);
          if (col === "valid_signature") assinada = v as boolean;
          return q;
        },
        gte: (col: string, v: unknown) => {
          filtros.push([col, v]);
          return Promise.resolve(porAssinatura[String(assinada) as "true" | "false"]);
        },
      };
      return q;
    },
  };
  return { admin: admin as never, filtros };
}

describe("carregarEvidenciaDeAssinatura", () => {
  it("conta só entregas do WAHA dentro da janela de 7 dias", async () => {
    const { admin, filtros } = adminFalso({
      true: { count: 40, error: null },
      false: { count: 0, error: null },
    });
    const ev = await carregarEvidenciaDeAssinatura(admin, new Date("2026-10-08T00:00:00Z"));
    expect(ev).toEqual({ assinadas: 40, semAssinatura: 0, dias: 7, veredito: "todas_assinadas" });
    expect(filtros).toContainEqual(["from", "webhook_events_log"]);
    expect(filtros).toContainEqual(["provider", "waha"]);
    expect(filtros).toContainEqual(["received_at", "2026-10-01T00:00:00.000Z"]);
  });

  it("erro do banco vira null — a tela cala em vez de afirmar 'não assina'", async () => {
    const { admin } = adminFalso({
      true: { count: null, error: { message: "timeout" } },
      false: { count: 3, error: null },
    });
    expect(await carregarEvidenciaDeAssinatura(admin)).toBeNull();
  });

  it("exceção também vira null, nunca derruba a tela", async () => {
    const admin = { from: () => { throw new Error("rede"); } } as never;
    expect(await carregarEvidenciaDeAssinatura(admin)).toBeNull();
  });
});
