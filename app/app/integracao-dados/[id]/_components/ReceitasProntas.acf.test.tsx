/**
 * Receitas prontas — caminho ACF (fatia R2, com categorias).
 * Prova:
 *   - quando a receita é acf-imoveis, mostra Tipo de post, os Campos do
 *     imóvel, as Categorias e o bloco "Esconder imóveis";
 *   - rótulos ligados aos inputs (useId + htmlFor);
 *   - escolher "categoria" para o bairro grava `taxonomias.bairro` (com o
 *     nível escolhido) e tira o dado de `campos`;
 *   - trocar para "não usar" remove a chave;
 *   - apagar um campo opcional tira a CHAVE do mapeamento (não manda "");
 *   - salvar envia os fixos completos do ACF (prefixo, post_type, campos,
 *     taxonomias, situacao);
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
        rotulo: "Imóveis do WordPress (ACF ou JetEngine)",
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
    campos: { preco: "preco", quartos: "quartos" },
    taxonomias: { bairro: { taxonomia: "localizacao", nivel: "filho" } },
    situacao: { campo: "situacao", ocultar: ["vendido", "alugado"] },
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

/** Abre a edição de uma receita nova (o caminho "Adicionar receita"). */
async function abrirNovaReceita() {
  const botaoAdicionar = screen.getByRole("button", { name: /Adicionar receita/i })!;
  await act(async () => {
    fireEvent.click(botaoAdicionar);
  });
}

/** Salva e devolve os "fixos" que foram para o PUT. */
async function salvarEObterFixos(): Promise<Record<string, unknown>> {
  const botaoSalvar = screen.getByRole("button", { name: /Salvar/i })!;
  await act(async () => {
    fireEvent.click(botaoSalvar);
  });
  const args = deps.salvarReceitas.mock.calls[0]![1] as InstanciaDeReceita[];
  return (args[0]!.fixos ?? {}) as Record<string, unknown>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Receitas prontas — caminho ACF", () => {
  it("adicionar acf-imoveis mostra Tipo de post, Campos do imóvel, Categorias e Esconder imóveis", async () => {
    renderComQuery([], true);
    await abrirNovaReceita();

    expect(screen.getByLabelText(/Tipo de post/i)).toBeInTheDocument();
    expect(screen.getByText("Campos do imóvel")).toBeInTheDocument();
    expect(screen.getByText("Categorias")).toBeInTheDocument();
    expect(screen.getByText("Esconder imóveis")).toBeInTheDocument();
  });

  it("os campos do imóvel têm um campo de texto cada, com a dica do ACF/JetEngine", async () => {
    renderComQuery([], true);
    await abrirNovaReceita();

    expect(screen.getByLabelText("Código")).toBeInTheDocument();
    expect(screen.getByLabelText("Preço de venda")).toBeInTheDocument();
    expect(screen.getByLabelText("Aluguel")).toBeInTheDocument();
    expect(screen.getByLabelText("Condomínio")).toBeInTheDocument();
    expect(screen.getByLabelText("Quartos")).toBeInTheDocument();
    expect(screen.getByLabelText("Suítes")).toBeInTheDocument();
    expect(screen.getByLabelText("Banheiros")).toBeInTheDocument();
    expect(screen.getByLabelText("Vagas")).toBeInTheDocument();
    expect(screen.getByLabelText("Área")).toBeInTheDocument();
    expect(screen.getByText(/O nome do campo no ACF ou no JetEngine/)).toBeInTheDocument();
  });

  it("as quatro categorias têm escolha de onde vem o dado", async () => {
    renderComQuery([], true);
    await abrirNovaReceita();

    for (const rotulo of ["Bairro", "Cidade", "Tipo", "Finalidade"]) {
      const escolha = screen.getByLabelText(rotulo);
      expect(escolha).toBeInTheDocument();
      expect(escolha).toHaveValue("nao-usar");
    }
    // As três opções: não usar, campo, categoria.
    expect(screen.getByRole("option", { name: "Não usar" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Campo" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Categoria" })).toBeInTheDocument();
  });

  it("escolher Categoria para o bairro grava taxonomias.bairro (e tira o dado de campos)", async () => {
    renderComQuery([], true);
    await abrirNovaReceita();

    // Primeiro como campo: o bairro vira um meta_key.
    const escolhaBairro = screen.getByLabelText("Bairro");
    await act(async () => {
      fireEvent.change(escolhaBairro, { target: { value: "campo" } });
    });
    const campoBairro = screen.getByLabelText("Nome do campo");
    await act(async () => {
      fireEvent.input(campoBairro, { target: { value: "bairro" } });
    });

    // Agora como categoria: o campo some e a taxonomia entra.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "categoria" } });
    });
    expect(screen.queryByLabelText("Nome do campo")).toBeNull();
    const slug = screen.getByLabelText("Nome da categoria");
    await act(async () => {
      fireEvent.input(slug, { target: { value: "localizacao" } });
    });

    const fixos = await salvarEObterFixos();
    const taxonomias = fixos.taxonomias as Record<string, { taxonomia: string; nivel: string }>;
    expect(taxonomias.bairro?.taxonomia).toBe("localizacao");
    const campos = fixos.campos as Record<string, string>;
    expect("bairro" in campos).toBe(false);
  });

  it("o nível da categoria (bairro = filho) vai para o PUT", async () => {
    renderComQuery([], true);
    await abrirNovaReceita();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "categoria" } });
    });
    await act(async () => {
      fireEvent.input(screen.getByLabelText("Nome da categoria"), {
        target: { value: "localizacao" },
      });
    });
    const nivel = screen.getByLabelText("Nível");
    await act(async () => {
      fireEvent.change(nivel, { target: { value: "filho" } });
    });

    const fixos = await salvarEObterFixos();
    const taxonomias = fixos.taxonomias as Record<string, { taxonomia: string; nivel: string }>;
    expect(taxonomias.bairro).toEqual({ taxonomia: "localizacao", nivel: "filho" });
  });

  it("trocar para NÃO USAR remove a chave", async () => {
    renderComQuery([], true);
    await abrirNovaReceita();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "categoria" } });
    });
    await act(async () => {
      fireEvent.input(screen.getByLabelText("Nome da categoria"), {
        target: { value: "localizacao" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "nao-usar" } });
    });

    const fixos = await salvarEObterFixos();
    const taxonomias = fixos.taxonomias as Record<string, unknown>;
    expect("bairro" in taxonomias).toBe(false);
    const campos = fixos.campos as Record<string, string>;
    expect("bairro" in campos).toBe(false);
  });

  it("editar uma instância ACF mostra o tipo de post e o mapeamento gravados", async () => {
    renderComQuery([INSTANCIA_ACF], true);

    const botaoEditar = screen.getByRole("button", { name: /Editar/i })!;
    await act(async () => {
      fireEvent.click(botaoEditar);
    });

    expect(screen.getByLabelText(/Tipo de post/i)).toHaveValue("imovel");
    expect(screen.getByLabelText("Preço de venda")).toHaveValue("preco");
    expect(screen.getByLabelText("Quartos")).toHaveValue("quartos");
    // A categoria gravada volta como "categoria", com o slug e o nível.
    expect(screen.getByLabelText("Bairro")).toHaveValue("categoria");
    expect(screen.getByLabelText("Nome da categoria")).toHaveValue("localizacao");
    expect(screen.getByLabelText("Nível")).toHaveValue("filho");
    // E a situação volta com o campo e os valores a esconder.
    expect(screen.getByLabelText("Campo da situação")).toHaveValue("situacao");
    expect(screen.getByLabelText("Valores a esconder")).toHaveValue("vendido, alugado");
  });

  it("o card de leitura da instância ACF mostra o tipo de post", () => {
    renderComQuery([INSTANCIA_ACF], false);

    expect(screen.getByText(/Tipo de post:/i)).toBeInTheDocument();
  });

  it("salvar acf-imoveis envia fixos completos (prefixo, post_type, campos, taxonomias, situacao)", async () => {
    renderComQuery([], true);
    await abrirNovaReceita();

    const inputPostType = screen.getByLabelText(/Tipo de post/i);
    await act(async () => {
      fireEvent.input(inputPostType, { target: { value: "apartamento" } });
    });

    const fixos = await salvarEObterFixos();
    expect(fixos.prefixo).toBe("wp_");
    expect(fixos.post_type).toBe("apartamento");
    const campos = fixos.campos as Record<string, string>;
    expect(campos.preco).toBe("preco");
    expect(campos.quartos).toBe("quartos");
    // A situação vai com o campo e os valores a esconder (padrão da receita).
    expect(fixos.situacao).toEqual({ campo: "situacao", ocultar: ["vendido", "alugado"] });
  });

  it("apagar um campo opcional tira a CHAVE do mapeamento (não grava vazio)", async () => {
    renderComQuery([], true);
    await abrirNovaReceita();

    const inputArea = screen.getByLabelText("Área");
    await act(async () => {
      fireEvent.input(inputArea, { target: { value: "120" } });
    });
    await act(async () => {
      fireEvent.input(inputArea, { target: { value: "" } });
    });

    const fixos = await salvarEObterFixos();
    const campos = fixos.campos as Record<string, string>;
    // A chave SAI: o Zod da receita é `.min(1).optional()`, e "" não vale como
    // ausente — mandar "" no PUT voltava 422 `fixos_invalidos`.
    expect("area" in campos).toBe(false);
    expect(Object.values(campos)).not.toContain("");
    // E os outros continuam mapeados.
    expect(campos.preco).toBe("preco");
    expect(campos.quartos).toBe("quartos");
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
    expect(screen.queryByText("Campos do imóvel")).toBeNull();
    expect(screen.queryByText("Categorias")).toBeNull();
    expect(screen.queryByText("Esconder imóveis")).toBeNull();
  });

  it("canWrite=false → nenhum botão de mudar", () => {
    renderComQuery([INSTANCIA_ACF], false);

    expect(screen.queryByRole("button", { name: /Adicionar receita/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Salvar/i })).toBeNull();
  });
});
