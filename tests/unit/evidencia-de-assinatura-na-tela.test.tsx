/**
 * O INTERRUPTOR "EXIGIR ASSINATURA" MOSTRA O QUE AS ENTREGAS REAIS DIZEM.
 *
 * Quem liga a exigência sem o WAHA assinar corta a entrada de mensagens de toda
 * a instalação. A tela agora mostra a contagem dos últimos dias ao lado do
 * interruptor e fica vermelha no único estado perigoso: exigência ligada com
 * entregas chegando sem assinatura. Ver lib/waha/evidencia-de-assinatura.ts.
 *
 * Roda com: npx vitest run tests/unit/evidencia-de-assinatura-na-tela.test.tsx
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/settings/updateComportamento", () => ({ updateComportamento: vi.fn() }));
vi.mock("@/app/actions/settings/updateModuloDaInstalacao", () => ({ updateModuloDaInstalacao: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { FormularioDeComportamento } from "@/app/admin/(protected)/sistema/_form";
import type { ComportamentoDaInstalacao } from "@/lib/instalacao/comportamento";
import { resumirEvidencia } from "@/lib/waha/evidencia-de-assinatura";

function comportamento(exigir: boolean): ComportamentoDaInstalacao {
  return {
    orcamento_de_ia: "on",
    exigir_assinatura_no_webhook: exigir,
    divulgacao_de_pagamento: "inject",
    promessa_semantica: false,
  };
}

describe("evidência de assinatura ao lado do interruptor", () => {
  it("todas assinadas: diz que dá para ligar, com os números", () => {
    render(<FormularioDeComportamento inicial={comportamento(false)} evidencia={resumirEvidencia(40, 0)} />);
    const linha = screen.getByTestId("evidencia-de-assinatura");
    expect(linha.textContent).toBe(
      "Nos últimos 7 dias, as 40 entregas do WhatsApp chegaram assinadas: dá para ligar sem cortar mensagens.",
    );
    expect(linha.className).not.toContain("text-destructive");
  });

  it("nenhuma assinada e exigência LIGADA: vermelho", () => {
    render(<FormularioDeComportamento inicial={comportamento(true)} evidencia={resumirEvidencia(0, 9)} />);
    const linha = screen.getByTestId("evidencia-de-assinatura");
    expect(linha.textContent).toContain("nenhuma das 9 entregas");
    expect(linha.className).toContain("text-destructive");
  });

  it("misto mostra quantas de quantas", () => {
    render(<FormularioDeComportamento inicial={comportamento(false)} evidencia={resumirEvidencia(3, 1)} />);
    expect(screen.getByTestId("evidencia-de-assinatura").textContent).toContain("3 de 4 entregas");
  });

  it("sem leitura (null) não mostra linha nenhuma — nunca um 'não assina' inventado", () => {
    render(<FormularioDeComportamento inicial={comportamento(false)} evidencia={null} />);
    expect(screen.queryByTestId("evidencia-de-assinatura")).toBeNull();
  });
});
