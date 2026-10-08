import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunTrace } from "@/app/app/ai/agents/[id]/_components/RunTrace";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

/**
 * O TRACE DA ABA TESTE MOSTRA O NOME REAL DA AÇÃO PROPOSTA E OS ARGUMENTOS.
 *
 * ## O defeito que este arquivo vigia (#2550)
 *
 * O `RunTrace` é alimentado por DUAS origens com formatos diferentes:
 *
 *   · a prévia do endpoint `:test` (aba Teste) entrega `{ tool, arguments }` —
 *     `lib/agent-engine/agent/preview.ts` e `TestPanel.tsx:294`;
 *   · os runs gravados entregam `{ tool_name, args }` — `serializeSteps` em
 *     `lib/ai/runtime/agent.ts`, lidos pelo `RunDetailDrawer.tsx:122`.
 *
 * O componente só conhecia o segundo: na aba Teste cada passo saía
 * `#1 (sem nome)` e, ao abrir, `Args: —`, enquanto a lista "Ações propostas"
 * logo abaixo mostrava `save_lead_note` — a mesma resposta da API desenhada
 * certa num lugar e errada no outro.
 *
 * ## O que a régua mede — e o que ela NÃO mede
 *
 * Aqui se RENDERIZA o trace com cada um dos dois formatos e se exige: nome
 * visível, `(sem nome)` ausente e os argumentos em JSON no bloco Args. O
 * segundo caso é regressão — o formato do runtime continua canônico.
 *
 * **NÃO MEDIDO aqui:** a rota de teste nem o serializador do runtime. Nada foi
 * normalizado em quem grava (mudaria o contrato gravado em
 * `ai_agent_runs.tool_calls` que o `RunDetailDrawer` lê) — a dualidade vive no
 * componente, por decisão registrada em #2550.
 */
const PROPOSTA_PREVIA = {
  tool: "save_lead_note",
  arguments: { headline: "Prefere ligação à tarde", body: "Ligar depois das 14h" },
};

const PASSO_RUNTIME = { step: 1, tool_name: "crm_get_lead", args: { id: "lead-1" } };

afterEach(() => {
  cleanup();
});

describe("RunTrace lê as DUAS origens de tool_call (#2550)", () => {
  it("na prévia ({ tool, arguments }) mostra o nome real e os argumentos em JSON", () => {
    render(<RunTrace toolCalls={[PROPOSTA_PREVIA]} />);

    expect(screen.getByText("save_lead_note")).toBeInTheDocument();
    expect(screen.queryByText("(sem nome)")).toBeNull();

    const args = screen.getByText(/Prefere ligação à tarde/);
    expect(args.tagName).toBe("PRE");
    expect(args.textContent).toContain('"headline"');
    expect(args.textContent).toContain('"Prefere ligação à tarde"');
    expect(args.textContent).not.toBe("—");
  });

  it("nos runs gravados ({ tool_name, args }) continua igual — regressão", () => {
    render(<RunTrace toolCalls={[PASSO_RUNTIME]} />);

    expect(screen.getByText("crm_get_lead")).toBeInTheDocument();
    expect(screen.queryByText("(sem nome)")).toBeNull();

    const args = screen.getByText(/"lead-1"/);
    expect(args.tagName).toBe("PRE");
    expect(args.textContent).toContain('"id"');
  });

  it("sem nenhum dos dois formatos, segue caindo em (sem nome) e Args —", () => {
    render(<RunTrace toolCalls={[{ step: 1, result: "ok" }]} />);

    expect(screen.getByText("(sem nome)")).toBeInTheDocument();
    // vários "—" na tela (latência, horários, Args…): o Args é um deles.
    const tracos = screen.getAllByText("—");
    expect(tracos.some((el) => el.tagName === "PRE")).toBe(true);
  });
});
