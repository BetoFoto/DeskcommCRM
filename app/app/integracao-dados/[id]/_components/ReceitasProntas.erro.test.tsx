/**
 * Receitas prontas — o ramo de ERRO da tela.
 *
 * Living System, item 1: nunca silêncio. Quando a query falha, a tela deve
 * mostrar uma mensagem legível com botão "Tentar de novo", e "Carregando…"
 * deve sumir.
 *
 * E o 422 da gravação: a rota devolve `details.fieldErrors` com o CAMINHO do
 * campo que falhou ("taxonomias.bairro.taxonomia", "situacao.ocultar"), e a
 * tela mostra o RÓTULO legível desse caminho ("Categoria do bairro", "Valores
 * a esconder") — nunca o caminho cru, que não diz nada para quem opera.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { act, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { toast } from "sonner";
import { ApiError } from "@/lib/api/types";

vi.mock("@/hooks/external-db/useReceitasDaConexao", () => ({
  useReceitasDaConexao: vi.fn(),
  salvarReceitas: vi.fn(),
  previewReceita: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import ReceitasProntas from "./ReceitasProntas";
import { salvarReceitas, useReceitasDaConexao } from "@/hooks/external-db/useReceitasDaConexao";
import type { InstanciaDeReceita } from "@/lib/external-db/receitas/tipos";

const mockUseReceitas = useReceitasDaConexao as ReturnType<typeof vi.fn>;
const mockSalvar = salvarReceitas as ReturnType<typeof vi.fn>;

const INSTANCIA_ACF: InstanciaDeReceita = {
  id: "inst-acf-1",
  receita: "acf-imoveis",
  rotulo: "Meus imóveis",
  descricao: "Imóveis publicados",
  fixos: {
    prefixo: "wp_",
    post_type: "imovel",
    campos: { preco: "preco", quartos: "quartos" },
    taxonomias: { bairro: { taxonomia: "localizacao", nivel: "filho" } },
    situacao: { campo: "situacao", ocultar: ["vendido", "alugado"] },
  },
  ativa: true,
};

function renderReceitasProntas(query: { isError: boolean; data: unknown; refetch: () => void }) {
  mockUseReceitas.mockReturnValue(query);
  return render(<ReceitasProntas connectionId="conn-1" motor="mysql" canWrite={true} />);
}

// O toast é lido pelo índice da chamada: sem limpar entre os testes, o
// segundo 422 leria a mensagem do primeiro.
afterEach(() => {
  vi.clearAllMocks();
});

describe("ReceitasProntas — erro na leitura", () => {
  it("query com erro: mostra mensagem e 'Tentar de novo', 'Carregando…' some", () => {
    renderReceitasProntas({
      isError: true,
      data: undefined,
      refetch: vi.fn(),
    });

    expect(screen.getByText("Não foi possível carregar as receitas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
    expect(screen.queryByText("Carregando receitas…")).not.toBeInTheDocument();
  });
});

describe("ReceitasProntas — o 422 da gravação", () => {
  it("mostra o rótulo legível do caminho que falhou (não o caminho cru)", async () => {
    mockUseReceitas.mockReturnValue({
      data: { receitas: [INSTANCIA_ACF] },
      isError: false,
      refetch: vi.fn(),
    });
    mockSalvar.mockRejectedValueOnce(
      new ApiError(
        422,
        "validation_failed",
        {
          fieldErrors: {
            "taxonomias.bairro.taxonomia": [
              "Use apenas letras minúsculas, números, underscore e hífen no nome da categoria.",
            ],
          },
        },
        "req-1",
        "Campos inválidos.",
      ),
    );

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReceitasProntas connectionId="conn-1" motor="mysql" canWrite={true} />
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Editar/i })!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Salvar/i })!);
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    const texto = vi.mocked(toast.error).mock.calls[0]![0] as string;
    expect(texto).toContain("Categoria do bairro");
    // E o caminho cru NÃO vaza para a tela.
    expect(texto).not.toContain("taxonomias.bairro.taxonomia");
  });

  it("a situação mostra 'Valores a esconder' (não o caminho cru)", async () => {
    mockUseReceitas.mockReturnValue({
      data: { receitas: [INSTANCIA_ACF] },
      isError: false,
      refetch: vi.fn(),
    });
    mockSalvar.mockRejectedValueOnce(
      new ApiError(
        422,
        "validation_failed",
        { fieldErrors: { "situacao.ocultar": ["Escreva pelo menos um valor a esconder."] } },
        "req-1",
        "Campos inválidos.",
      ),
    );

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReceitasProntas connectionId="conn-1" motor="mysql" canWrite={true} />
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Editar/i })!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Salvar/i })!);
    });

    const texto = vi.mocked(toast.error).mock.calls[0]![0] as string;
    expect(texto).toContain("Valores a esconder");
    expect(texto).not.toContain("situacao.ocultar");
  });
});
