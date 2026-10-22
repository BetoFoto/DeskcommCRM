/**
 * #3310 (parte 3, separada do #3318 para decisão do dono) — a assinatura da IA
 * com mais de um agente no mesmo número. Trabalho de @webtecnica.
 */
import { describe, expect, it, vi } from "vitest";

import { configAssinatura, linhaDeAssinatura, nomeDaAssinaturaDaIA } from "@/lib/messaging/assinatura";
import { nomeDoAgenteDeIA } from "@/lib/messaging/nome-do-agente-de-ia";

const ORG = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";

describe("#3310 · assinatura — quem falou assina, não quem a organização configurou", () => {
  const config = configAssinatura({ assinatura_mensagens: { humanos: true, ia: true, nome_ia: "Assistente Virtual" } });

  it("o nome do AGENTE que enviou ganha do `nome_ia` da organização", () => {
    expect(nomeDaAssinaturaDaIA(config, "Bia da Locação")).toBe("Bia da Locação");
    expect(linhaDeAssinatura(config, "ai", null, "Bia da Locação")).toBe("*Bia da Locação*\n");
  });

  it("sem agente (ou sem nome), a reserva é o `nome_ia` de sempre", () => {
    expect(nomeDaAssinaturaDaIA(config, null)).toBe("Assistente Virtual");
    expect(nomeDaAssinaturaDaIA(config, "   ")).toBe("Assistente Virtual");
    expect(linhaDeAssinatura(config, "ai", null, null)).toBe("*Assistente Virtual*\n");
    expect(linhaDeAssinatura(config, "ai", null)).toBe("*Assistente Virtual*\n");
  });

  it("nome de agente que desmonta a linha (`*`, quebra de linha) cai na reserva", () => {
    expect(nomeDaAssinaturaDaIA(config, "Bia *Locação*")).toBe("Assistente Virtual");
    expect(nomeDaAssinaturaDaIA(config, "Bia\nLocação")).toBe("Assistente Virtual");
  });

  it("um id que não é de agente nem chega ao banco (aviso do sistema assina com `nome_ia`)", async () => {
    const supabase = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn() })) })) };
    await expect(
      nomeDoAgenteDeIA(supabase as never, ORG, "handoff-orchestrator"),
    ).resolves.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("o nome do agente é lido da organização certa, e uma falha não derruba o envio", async () => {
    const cadeia = (resultado: { data: unknown; error: unknown }) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => resultado }) }) }),
    });
    const ok = { from: vi.fn(() => cadeia({ data: { name: "Bia da Locação" }, error: null })) };
    await expect(nomeDoAgenteDeIA(ok as never, ORG, LEAD)).resolves.toBe("Bia da Locação");

    const falha = { from: vi.fn(() => cadeia({ data: null, error: { message: "boom" } })) };
    await expect(nomeDoAgenteDeIA(falha as never, ORG, LEAD)).resolves.toBeNull();
  });
});
