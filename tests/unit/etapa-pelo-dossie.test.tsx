import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * MUDAR A ETAPA PELO DOSSIÊ.
 *
 * ─── O pedido, de quem usa ──────────────────────────────────────────────────
 *
 * "Quando estou no card de um lead e quero mover de etapa, só dá para arrastar
 * no quadro ou ir na conversa. No card não dá." O dossiê mostrava a etapa como
 * TEXTO no cabeçalho: era a única superfície do negócio sem como mudá-la, e é
 * justamente onde se decide o próximo passo.
 *
 * A perda continua pedindo motivo (o mesmo `LoseLeadDialog` do card e da
 * conversa) e o movimento é o MESMO `useMoveCard` do arrasto — por isso o
 * componente não move nada sozinho: ele chama `onMudar`, e os testes de baixo
 * conferem que o quadro liga esse fio ao `moveCard`.
 */
vi.mock("@/components/kanban/LoseLeadDialog", () => ({
  LoseLeadDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">motivo da perda</div> : null),
}));

import { EtapaNoDossie } from "@/components/kanban/EtapaNoDossie";

// O Select do Radix usa APIs de ponteiro/rolagem que o jsdom não tem (mesmo apoio de etapa-pela-conversa.test.tsx).
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

const etapas = [
  { id: "s-novo", name: "Novo Lead", is_lost: false },
  { id: "s-neg", name: "Negociando", is_lost: false },
  { id: "s-perdeu", name: "Perdemos", is_lost: true },
];

function montar(extra: Partial<Parameters<typeof EtapaNoDossie>[0]> = {}) {
  const onMudar = vi.fn();
  render(
    <EtapaNoDossie
      leadId="l-1"
      pipelineId="p-1"
      etapaAtual="s-novo"
      etapas={etapas}
      podeMover
      onMudar={onMudar}
      {...extra}
    />,
  );
  return onMudar;
}

describe("dossiê — Etapa do funil", () => {
  it("mostra a etapa atual num seletor com as etapas do funil, na ordem", async () => {
    montar();
    const user = userEvent.setup();
    const seletor = screen.getByRole("combobox", { name: "Etapa do funil" });
    expect(seletor.textContent).toContain("Novo Lead");
    await user.click(seletor);
    const opcoes = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(opcoes).toEqual(["Novo Lead", "Negociando", "Perdemos"]);
  });

  it("escolher outra etapa pede o movimento a quem chama, com o id da etapa", async () => {
    const onMudar = montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Etapa do funil" }));
    await user.click(await screen.findByRole("option", { name: "Negociando" }));
    expect(onMudar).toHaveBeenCalledTimes(1);
    expect(onMudar).toHaveBeenCalledWith("s-neg");
  });

  it("escolher a etapa em que já está não move", async () => {
    const onMudar = montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Etapa do funil" }));
    await user.click(await screen.findByRole("option", { name: "Novo Lead" }));
    expect(onMudar).not.toHaveBeenCalled();
  });

  it("a etapa de perda NÃO move direto: abre o motivo da perda", async () => {
    // Uma perda sem motivo por um caminho que nenhuma outra tela permite
    // deixaria o funil com dois jeitos de perder e um só com motivo.
    const onMudar = montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Etapa do funil" }));
    await user.click(await screen.findByRole("option", { name: "Perdemos" }));
    expect(onMudar).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("motivo da perda");
  });

  it("sem permissão de mover, fica o texto da etapa — sem seletor que recusaria no clique", () => {
    montar({ podeMover: false });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Novo Lead")).toBeInTheDocument();
  });

  it("sem a lista de etapas, também fica o texto", () => {
    montar({ etapas: [] });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("o fio que some sem barulho", () => {
  // O componente sozinho não move card nenhum: o defeito voltaria se o dossiê
  // deixasse de montá-lo ou se o quadro deixasse de ligar `onMudarEtapa` ao
  // MESMO `moveCard` do arrasto (campos obrigatórios, trava de updated_at).
  const dossie = readFileSync("components/kanban/LeadDossier.tsx", "utf8");
  const quadro = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");

  it("o dossiê monta o seletor com a permissão de mover card", () => {
    expect(dossie).toMatch(/<EtapaNoDossie[\s\S]*?onMudar=\{onMudarEtapa\}/);
    expect(dossie).toMatch(/usePermission\("pipeline\.move_card"\)/);
  });

  it("o quadro passa as etapas e move pelo moveCard do arrasto", () => {
    expect(quadro).toMatch(/etapas=\{data\.stages\}/);
    expect(quadro).toMatch(/onMudarEtapa=\{\(stageId\) => moverPeloDossie\(leadDoDossie, stageId\)\}/);
    const corpo = quadro.slice(quadro.indexOf("const moverPeloDossie"), quadro.indexOf("if (isLoading)"));
    expect(corpo).toMatch(/moveCard\.mutate\(/);
    expect(corpo).toMatch(/expectedUpdatedAt: lead\.updated_at/);
  });
});
