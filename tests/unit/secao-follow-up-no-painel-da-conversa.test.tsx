import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CRMSidePanel } from "@/components/inbox/CRMSidePanel";

/**
 * A PORTA DE FOLLOW-UP no painel da conversa (#3178).
 *
 * O painel dizia quem é o contato, o que ele pediu (demanda), o que foi
 * combinado (tarefa) — e não dizia se um follow-up está rodando nele, nem dava
 * como armá-lo ou desarmá-lo sem sair da tela. O efeito era a ausência da seção
 * "Follow-up" no painel. Estes casos guardam:
 *
 *  1. **O enrollment vivo aparece** — o GET `?status=active` é da ORGANIZAÇÃO;
 *     a seção só pode mostrar o do CONTATO desta conversa. Um enrollment de
 *     outro contato na lista é o caso que separa "leu" de "filtrou".
 *  2. **Iniciar manda pointer_id e contact_id** — sem os dois o POST não inscreve
 *     ninguém; a rota cobra o par em `createFollowupEnrollmentSchema`.
 *  3. **Parar chama o cancel do enrollment vivo** — não é um "desmarcar" local:
 *     a escrita vai para `POST .../:id/cancel`.
 *  4. **Auto-ocultação** — sem enrollment vivo e sem fluxo ativo a seção não
 *     existe; é o contrato de `RoteirosDoContato` (módulo/estado sem dado não
 *     muda a tela de quem não usa).
 *  5. **Readonly esconde a escrita, não a leitura** — o painel expõe `readonly`
 *     (`support_readonly`); quem não pode escrever ainda enxerga o que roda e
 *     não ganha botão que levaria 403.
 */

const CONTACT = "c0000000-0000-4000-8000-000000000001";

const conversation = {
  id: "cv-1",
  organization_id: "org-1",
  contact_id: CONTACT,
  tags: [],
  contacts: { id: CONTACT, display_name: "Fulana", name: null, phone_number: "5511999", tags: [] },
} as unknown as React.ComponentProps<typeof CRMSidePanel>["conversation"];

const RESPOSTA = { leads: [], orders: [], activities: [], demandas: [] };

const FLUXO = {
  id: "f0000000-0000-4000-8000-0000000000aa",
  name: "Recuperação de carrinho",
  status: "active",
  active_version_id: "v-1",
  handoff_policy: "pause",
  updated_at: "2026-08-01T00:00:00Z",
};

const ENROLLMENT = {
  id: "e0000000-0000-4000-8000-0000000000bb",
  pointer_id: FLUXO.id,
  version_id: "v-1",
  contact_id: CONTACT,
  status: "active",
  current_node_id: "n-1",
  next_eval_at: null,
  outcome: null,
  started_at: "2026-08-01T00:00:00Z",
  completed_at: null,
  updated_at: "2026-08-01T00:00:00Z",
};

/** Mutable: cada caso decide se a sessão é de leitura ou de escrita. */
let authUser: Record<string, unknown> = { support: null };

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));
vi.mock("@/hooks/pipelines/useDefaultPipeline", () => ({
  useDefaultPipeline: () => ({ data: null, isError: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useUpdateConversationTags: () => ({ mutate: vi.fn(), isPending: false }),
  useConversationTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useUpdateContact", () => ({
  useUpdateContact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: authUser, activeOrg: { role: "manager" } }),
}));

function renderPainel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CRMSidePanel conversation={conversation} />
    </QueryClientProvider>,
  );
}

/** O GET do follow-up é por URL; o crm-summary do painel continua sendo o default. */
function servirApi(opts: { enrollments?: unknown[]; flows?: unknown[] }) {
  get.mockImplementation((url: string) => {
    if (url.includes("/followups/enrollments")) return Promise.resolve({ data: opts.enrollments ?? [] });
    if (url.includes("/followup-flows")) return Promise.resolve({ data: opts.flows ?? [] });
    return Promise.resolve({ data: RESPOSTA });
  });
}

beforeEach(() => {
  authUser = { support: null };
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  post.mockResolvedValue({ data: { id: "e-novo" } });
});

describe("painel do inbox — seção de follow-up", () => {
  it("com fluxo ativo, oferece iniciar: manda pointer_id e contact_id", async () => {
    servirApi({ flows: [FLUXO] });
    renderPainel();

    const secao = await screen.findByTestId("inbox-followup");
    expect(secao.textContent).toMatch(/follow-up/i);

    await userEvent.selectOptions(screen.getByLabelText("Fluxo de follow-up"), FLUXO.id);
    await userEvent.click(screen.getByTestId("iniciar-followup"));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/ai/followups/enrollments", {
      pointer_id: FLUXO.id,
      contact_id: CONTACT,
    });
  });

  it("o enrollment vivo do CONTATO aparece e o parar chama o cancel", async () => {
    servirApi({ enrollments: [ENROLLMENT] });
    renderPainel();

    const secao = await screen.findByTestId("inbox-followup");
    // O status é dito por escrito, não só por cor.
    expect(secao.textContent).toMatch(/ativo/i);

    await userEvent.click(screen.getByTestId("parar-followup"));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(`/api/v1/ai/followups/enrollments/${ENROLLMENT.id}/cancel`, {});
  });

  it("enrollment de OUTRO contato não é o desta conversa — filtro pelo contato", async () => {
    servirApi({ enrollments: [{ ...ENROLLMENT, contact_id: "outro-contato" }] });
    renderPainel();

    // Sem vivo DESTE contato e sem fluxo ativo, a seção se auto-oculta.
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("inbox-followup")).toBeNull();
  });

  it("sem enrollment vivo e sem fluxo ativo, a seção não existe", async () => {
    servirApi({ enrollments: [], flows: [] });
    renderPainel();

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("inbox-followup")).toBeNull();
  });

  it("fluxo inativo não oferta iniciar — nada a fazer", async () => {
    servirApi({ flows: [{ ...FLUXO, status: "draft", active_version_id: null }] });
    renderPainel();

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("inbox-followup")).toBeNull();
  });

  it("em readonly a LEITURA fica e a ESCRITA some", async () => {
    authUser = { support: { access_mode: "support_readonly" } };
    servirApi({ enrollments: [ENROLLMENT] });
    renderPainel();

    const secao = await screen.findByTestId("inbox-followup");
    expect(secao.textContent).toMatch(/ativo/i);
    expect(screen.queryByTestId("parar-followup")).toBeNull();
  });

  it("em readonly, sem enrollment vivo, não sobra porta de escrita vazia", async () => {
    authUser = { support: { access_mode: "support_readonly" } };
    servirApi({ flows: [FLUXO] });
    renderPainel();

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("inbox-followup")).toBeNull();
  });
});
