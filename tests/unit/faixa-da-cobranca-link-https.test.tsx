import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FaixaDaCobranca } from "@/components/cobranca/FaixaDaCobranca";

afterEach(cleanup);

const atraso = (link: string) => ({ tipo: "atraso" as const, desde: "2026-10-01T12:00:00Z", link });

describe("FaixaDaCobranca — o link de pagamento só vira href se for https", () => {
  it("⭐ https válido: o botão aponta para a fatura", () => {
    render(<FaixaDaCobranca faixa={atraso("https://invoice.example.com/i/x")} />);
    expect(screen.getByRole("link", { name: "Pagar agora" }).getAttribute("href")).toBe("https://invoice.example.com/i/x");
  });

  it("⭐ javascript: nunca vira href; cai no painel do plano", () => {
    render(<FaixaDaCobranca faixa={atraso("javascript:alert(1)")} />);
    expect(screen.getByRole("link", { name: "Pagar agora" }).getAttribute("href")).toBe("/app/settings/billing");
  });
});
