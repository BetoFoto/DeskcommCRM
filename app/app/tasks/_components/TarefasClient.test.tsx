import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TarefasClient } from "./TarefasClient";

/**
 * "MINHAS TAREFAS" — o que o lembrete abre (`/app/tasks?assigned_to=me`).
 *
 * O `useTasks` é o de verdade e só o `fetch` é dublê: o que se prova é a URL
 * que sai da tela, porque é ela que decide quais tarefas a rota devolve.
 */

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useUser: () => ({ id: "u-eu" }) }));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({ isSuccess: true, data: [] }),
}));

const fetchEspiao = vi.fn(
  async (_url: string) =>
    new Response(JSON.stringify({ data: { tasks: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
);

beforeEach(() => {
  fetchEspiao.mockClear();
  vi.stubGlobal("fetch", fetchEspiao);
});
afterEach(() => vi.unstubAllGlobals());

function renderTela(minhasDeInicio: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TarefasClient podeEditar minhasDeInicio={minhasDeInicio} />
    </QueryClientProvider>,
  );
}

const urls = () => fetchEspiao.mock.calls.map(([url]) => String(url));

describe("TarefasClient — Minhas | Todas", () => {
  it("⭐ aberta pelo lembrete, a busca leva assigned_to=me", async () => {
    renderTela(true);

    await waitFor(() => expect(fetchEspiao).toHaveBeenCalled());
    expect(urls()[0]).toContain("assigned_to=me");
    expect(screen.getByRole("button", { name: "Minhas" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("tocar em 'Todas' faz a próxima busca sair sem o filtro", async () => {
    renderTela(true);
    await waitFor(() => expect(fetchEspiao).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: "Todas" }));

    await waitFor(() => expect(urls().at(-1)).not.toContain("assigned_to"));
    expect(urls().at(-1)).toContain("aberto=true");
  });

  it("aberta pelo menu, mostra todas", async () => {
    renderTela(false);

    await waitFor(() => expect(fetchEspiao).toHaveBeenCalled());
    expect(urls()[0]).not.toContain("assigned_to");
  });
});
