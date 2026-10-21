/**
 * Receitas prontas — caminho ACF (fatia R2).
 * Prova:
 *   - quando a receita é acf-imoveis, mostra Tipo de post e o mapeamento de
 *     meta_key de cada campo;
 *   - rótulos ligados aos inputs (useId + htmlFor);
 *   - os campos exigidos (Preço, Quartos, Bairro) vêm preenchidos e os
 *     opcionais (Cidade, Área) vêm vazios;
 *   - salvar envia os fixos completos do ACF (prefixo, post_type, campos);
 *   - a receita que NÃO é ACF não recebe o formulário de ACF.
 *
 * Sem sugestão automática (é da R5) e sem foto (é da R4).
 */
import type { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ReceitasProntas from "./ReceitasProntas";
import type { InstanciaDeReceita } from "@/lib/external-db/receitas/tipos";

const receitasMock = vi.hoisted(() => ({
  mapa: new Map([
    [
      "acf-imoveis",
      {
        id: "acf-imoveis",
        familia: "acf-imoveis",
        motores: ["mysql"],
        rotulo: "Imóveis do WordPress com ACF",
        descricao: "Imóveis publicados com ACF",
        parametrosFixos: {} as z.ZodTypeAny,
        parametrosDaBusca: {} as z.ZodTypeAny,
        tabelas: () => ["wp_posts", "wp_postmeta"],
        colunas: () => ({ wp_posts: ["ID"], wp_postmeta: ["post_id", "meta_key", "meta_value"] }),
        montar: () => ({ sql: "select ...", valores: [] }),
        tetoDeItens: 5,
      },
    ],
    [
      "woocommerce-produtos",
      {
        id: "woocommerce-produtos",
        familia: "woocommerce",
        motores: ["mysql"],
        rotulo: "Produtos da loja WooCommerce",
        descricao: "Produtos da loja",
        parametrosFixos: {} as z.ZodTypeAny,
        parametrosDaBusca: {} as z.ZodTypeAny,
        tabelas: () => ["wp_posts"],
        colunas: () => ({ wp_posts: ["ID"] }),
        montar: () => ({ sql: "select ...", valores: [] }),
        tetoDeItens: 5,
      },
    ],
  ]),
}));

vi.mock("@/lib/external-db/receitas/registro", () => ({
  RECEITAS: receitasMock.mapa,
  receitaDe: (id: string) => receitasMock.mapa.get(id),
}));

const INSTANCIA_ACF: InstanciaDeReceita = {
  id: "inst-acf-1",
  receita: "acf-imoveis",
  rotulo: "Meus imóveis",
  descricao: "Imóveis publicados",
  fixos: {
    prefixo: "wp_",
    post_type: "imovel",
    campos: { preco: "preco", quartos: "quartos", bairro: "bairro" },
  },
  ativa: true,
};

const deps = vi.hoisted(() => ({
  useReceitasDaConexao: vi.fn(),
  salvarReceitas: vi.fn(),
  previewReceita: vi.fn(),
}));

vi.mock("@/hooks/external-db/useReceitasDaConexao", () => ({
  useReceitasDaConexao: deps.useReceitasDaConexao,
  salvarReceitas: deps.salvarReceitas,
  previewReceita: deps.previewReceita,
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/lib/random-id", () => ({ randomId: () => "id-gerado" }));

function renderComQuery(receitas: InstanciaDeReceita[], canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  deps.useReceitasDaConexao.mockReturnValue({
    data: { receitas },
    isError: false,
    refetch: vi.fn(async () => ({}) as { status: number }),
  });
  deps.salvarReceitas.mockResolvedValue({ receitas });
  deps.previewReceita.mockResolvedValue({
    instancia: { id: "inst-1", receita: "acf-imoveis", rotulo: "Imóveis" },
    colunas: ["id", "titulo", "preco"],
    linhas: [{ id: "1", titulo: "Apê", preco: "500000" }],
    linhas_devolvidas: 1,
  });

  const ui = <ReceitasProntas connectionId="conn-1" motor="mysql" canWrite={canWrite} />;
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Receitas prontas — caminho ACF", () => {
  it("adicionar acf-imoveis mostra Tipo de post e mapeamento de campos", async () => {
    renderComQuery([], true);

    const botaoAdicionar = screen.getByRole("button", { name: /Adicionar receita/i })!;
    await act(async () => {
      fireEvent.click(botaoAdicionar);
    });

    // Tipo de post
    expect(screen.getByLabelText(/Tipo de post/i)).toBeInTheDocument();
    // Mapeamento de campos obrigatórios
    expect(screen.getByLabelText(/Preço \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quartos \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Bairro \*/i)).toBeInTheDocument();
    // Opcionais
    expect(screen.getByLabelText(/Cidade/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Área/i)).toBeInTheDocument();
  });

  it("labels estão ligados aos inputs (htmlFor/id) — getByLabelText acha cada campo", async () => {
    renderComQuery([], true);

    const botaoAdicionar = screen.getByRole("button", { name: /Adicionar receita/i })!;
    await act(async () => {
      fireEvent.click(botaoAdicionar);
    });

    // Cada input de mapeamento tem label ligado.
    expect(screen.getByLabelText(/Preço \*/i)).toHaveValue("preco");
    expect(screen.getByLabelText(/Quartos \*/i)).toHaveValue("quartos");
    expect(screen.getByLabelText(/Bairro \*/i)).toHaveValue("bairro");
    expect(screen.getByLabelText(/Cidade/i)).toHaveValue("");
    expect(screen.getByLabelText(/Área/i)).toHaveValue("");
  });

  it("editar uma instância ACF mostra o tipo de post e o mapeamento gravados", async () => {
    renderComQuery([INSTANCIA_ACF], true);

    const botaoEditar = screen.getByRole("button", { name: /Editar/i })!;
    await act(async () => {
      fireEvent.click(botaoEditar);
    });

    expect(screen.getByLabelText(/Tipo de post/i)).toHaveValue("imovel");
    expect(screen.getByLabelText(/Preço \*/i)).toHaveValue("preco");
    expect(screen.getByLabelText(/Quartos \*/i)).toHaveValue("quartos");
    expect(screen.getByLabelText(/Bairro \*/i)).toHaveValue("bairro");
  });

  it("o card de leitura da instância ACF mostra o tipo de post", () => {
    renderComQuery([INSTANCIA_ACF], false);

    expect(screen.getByText(/Tipo de post:/i)).toBeInTheDocument();
  });

  it("salvar acf-imoveis envia fixos completos (prefixo, post_type, campos)", async () => {
    renderComQuery([], true);

    const botaoAdicionar = screen.getByRole("button", { name: /Adicionar receita/i })!;
    await act(async () => {
      fireEvent.click(botaoAdicionar);
    });

    // Mudar tipo de post
    const inputPostType = screen.getByLabelText(/Tipo de post/i);
    await act(async () => {
      fireEvent.input(inputPostType, { target: { value: "apartamento" } });
    });

    const botaoSalvar = screen.getByRole("button", { name: /Salvar/i })!;
    await act(async () => {
      fireEvent.click(botaoSalvar);
    });

    const args = deps.salvarReceitas.mock.calls[0]![1] as InstanciaDeReceita[];
    expect(args).toHaveLength(1);
    expect(args[0]!.receita).toBe("acf-imoveis");
    const fixos = args[0]!.fixos as {
      prefixo: string;
      post_type: string;
      campos: Record<string, string>;
    };
    expect(fixos.prefixo).toBe("wp_");
    expect(fixos.post_type).toBe("apartamento");
    expect(fixos.campos.preco).toBe("preco");
    expect(fixos.campos.quartos).toBe("quartos");
    expect(fixos.campos.bairro).toBe("bairro");
  });

  it("a receita que não é ACF não recebe o formulário de ACF", async () => {
    const instWoo: InstanciaDeReceita = {
      id: "inst-woo-1",
      receita: "woocommerce-produtos",
      rotulo: "Produtos",
      descricao: "",
      fixos: { prefixo: "wp_" },
      ativa: true,
    };
    renderComQuery([instWoo], true);

    const botaoEditar = screen.getByRole("button", { name: /Editar/i })!;
    await act(async () => {
      fireEvent.click(botaoEditar);
    });

    expect(screen.queryByLabelText(/Tipo de post/i)).toBeNull();
    expect(screen.queryByLabelText(/Preço \*/i)).toBeNull();
    expect(screen.queryByText(/Mapeamento de campos/i)).toBeNull();
  });

  it("canWrite=false → nenhum botão de mudar", () => {
    renderComQuery([INSTANCIA_ACF], false);

    expect(screen.queryByRole("button", { name: /Adicionar receita/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Salvar/i })).toBeNull();
  });
});
