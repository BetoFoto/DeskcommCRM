/**
 * Teste unitário da receita `acf-imoveis` SEM MySQL de verdade.
 *
 * Prova que o SQL montado pela receita:
 *  - filtra `post_type = ?` e `post_status = 'publish'` (rascunho nunca entra),
 *  - NÃO tem junção obrigatória (todo campo é LEFT JOIN): imóvel sem o campo
 *    continua na lista — é o caso do imóvel só de aluguel;
 *  - coloca todo `meta_key` e todo slug de taxonomia como VALOR (`?`), nunca
 *    como identificador no texto;
 *  - lê a CATEGORIA pelas três tabelas de termos (terms, term_taxonomy,
 *    term_relationships) — e só as libera quando há categoria mapeada;
 *  - sai com `group_concat` (um imóvel com dois termos sai UMA vez);
 *  - filtra por categoria com `exists` (e pelo nível: filho/raiz);
 *  - a finalidade casa por IGUALDADE (o termo É "venda"/"aluguel"), enquanto
 *    bairro, cidade e tipo casam pelo pedaço do texto;
 *  - esconde o imóvel cuja situação está na lista de valores a esconder;
 *  - valida prefixo, post_type, meta_key e slug com regex (Zod recusa inválidos),
 *  - placeholders alinhados com valores na ordem do texto,
 *  - NÃO traz foto (a imagem_url é da R4 — ver a guarda no fim do arquivo).
 */
import { describe, expect, it } from "vitest";

import { RECEITA_ACF_IMOVEIS } from "./acf-imoveis";
import { DADOS_DE_CATEGORIA } from "./taxonomia";
import { validarConsultaDeReceita } from "./validador";

/** Só campos: nenhum dado vem de categoria. */
const FIXOS_SO_CAMPOS = {
  prefixo: "wp_",
  post_type: "imovel",
  campos: { preco: "preco", aluguel: "aluguel", quartos: "quartos" },
};

/** Só categoria: nenhum dado vem de campo. */
const FIXOS_SO_TAXONOMIA = {
  prefixo: "wp_",
  post_type: "imovel",
  campos: { preco: "preco" },
  taxonomias: {
    bairro: { taxonomia: "localizacao", nivel: "filho" },
    cidade: { taxonomia: "localizacao", nivel: "raiz" },
    tipo: { taxonomia: "tipo_imovel" },
    finalidade: { taxonomia: "finalidade" },
  },
};

/** Misturado: metade campo, metade categoria. */
const FIXOS_MISTO = {
  prefixo: "wp_",
  post_type: "imovel",
  campos: {
    codigo: "codigo",
    preco: "preco",
    aluguel: "aluguel",
    condominio: "condominio",
    quartos: "quartos",
    suites: "suites",
    banheiros: "banheiros",
    vagas: "vagas",
    area: "area",
  },
  taxonomias: {
    bairro: { taxonomia: "localizacao", nivel: "filho" },
    cidade: { taxonomia: "localizacao", nivel: "raiz" },
  },
  situacao: { campo: "situacao", ocultar: ["vendido", "alugado"] },
};

/** Renderiza o SQL com os valores no lugar, para ler o texto como o banco lê. */
function renderizar(sql: string, valores: unknown[]): string {
  const partes = sql.split("?");
  if (partes.length - 1 !== valores.length) {
    throw new Error(`esperava ${valores.length} placeholders, achou ${partes.length - 1}`);
  }
  let texto = "";
  for (let i = 0; i < partes.length; i++) {
    texto += partes[i];
    if (i < valores.length) {
      const v = valores[i];
      texto += typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v);
    }
  }
  return texto;
}

describe("receita acf-imoveis (unit, sem MySQL)", () => {
  describe("as regras do Zod dos fixos", () => {
    it("aceita só campos (preço e/ou aluguel)", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse(FIXOS_SO_CAMPOS);
      expect(parseado.success).toBe(true);
    });

    it("aceita só taxonomia (com o preço em campo)", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse(FIXOS_SO_TAXONOMIA);
      expect(parseado.success).toBe(true);
    });

    it("aceita o mapeamento completo (misturado)", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse(FIXOS_MISTO);
      expect(parseado.success).toBe(true);
    });

    it("recusa sem preço E sem aluguel (não há como filtrar por preço)", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { quartos: "quartos" },
      });
      expect(parseado.success).toBe(false);
      const mensagem = parseado.success ? "" : parseado.error.issues[0]?.message ?? "";
      expect(mensagem).toContain("preço de venda");
    });

    it("aceita só o aluguel (imóvel só de aluguel é um cadastro real)", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { aluguel: "aluguel" },
      });
      expect(parseado.success).toBe(true);
    });

    it("recusa o mesmo dado em campo E em categoria (duas fontes)", () => {
      for (const dado of ["bairro", "cidade", "tipo", "finalidade"] as const) {
        const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
          prefixo: "wp_",
          post_type: "imovel",
          campos: { preco: "preco", [dado]: "meta_" + dado },
          taxonomias: { [dado]: { taxonomia: "localizacao" } },
        });
        expect(parseado.success, `duplicou ${dado}`).toBe(false);
        const mensagem = parseado.success ? "" : parseado.error.issues[0]?.message ?? "";
        expect(mensagem).toContain("campo ou categoria");
      }
    });

    it("recusa slug de taxonomia fora do padrão do WordPress", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { preco: "preco" },
        taxonomias: { bairro: { taxonomia: "Localizacao" } },
      });
      expect(parseado.success).toBe(false);
    });

    it("recusa nível que não faz sentido para a categoria (bairro não é raiz, cidade não é filho)", () => {
      const bairroRaiz = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { preco: "preco" },
        taxonomias: { bairro: { taxonomia: "localizacao", nivel: "raiz" } },
      });
      expect(bairroRaiz.success).toBe(false);

      const cidadeFilha = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { preco: "preco" },
        taxonomias: { cidade: { taxonomia: "localizacao", nivel: "filho" } },
      });
      expect(cidadeFilha.success).toBe(false);
    });

    it("recusa nível em tipo e finalidade (não têm hierarquia)", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { preco: "preco" },
        taxonomias: { tipo: { taxonomia: "tipo_imovel", nivel: "filho" } },
      });
      expect(parseado.success).toBe(false);
    });

    it("recusa prefixo, post_type e meta_key inválidos", () => {
      expect(
        RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
          prefixo: "wp; drop table",
          post_type: "imovel",
          campos: { preco: "preco" },
        }).success,
      ).toBe(false);
      expect(
        RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
          prefixo: "wp_",
          post_type: "Imóvel",
          campos: { preco: "preco" },
        }).success,
      ).toBe(false);
      expect(
        RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
          prefixo: "wp_",
          post_type: "imovel",
          campos: { preco: "preco; drop table" },
        }).success,
      ).toBe(false);
    });

    it("recusa chave desconhecida (strict)", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { preco: "preco" },
        foto: "imagem",
      });
      expect(parseado.success).toBe(false);
    });

    it("a situação tem o padrão de valores a esconder e recusa lista vazia ou enorme", () => {
      const comPadrao = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { preco: "preco" },
        situacao: { campo: "situacao" },
      });
      expect(comPadrao.success).toBe(true);
      expect(comPadrao.success && comPadrao.data.situacao?.ocultar).toEqual(["vendido", "alugado"]);

      expect(
        RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
          prefixo: "wp_",
          post_type: "imovel",
          campos: { preco: "preco" },
          situacao: { campo: "situacao", ocultar: [] },
        }).success,
      ).toBe(false);

      expect(
        RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
          prefixo: "wp_",
          post_type: "imovel",
          campos: { preco: "preco" },
          situacao: {
            campo: "situacao",
            ocultar: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
          },
        }).success,
      ).toBe(false);
    });
  });

  describe("as regras do Zod da busca", () => {
    it("aceita os filtros de preço, aluguel, quartos, vagas e finalidade", () => {
      const parseado = RECEITA_ACF_IMOVEIS.parametrosDaBusca.safeParse({
        bairro: "centro",
        cidade: "sorocaba",
        tipo: "casa",
        finalidade: "aluguel",
        quartos_min: 2,
        vagas_min: 1,
        preco_max: 600000,
        aluguel_max: 3000,
        limite: 3,
      });
      expect(parseado.success).toBe(true);
    });

    it("recusa finalidade fora de venda/aluguel e limite acima do teto", () => {
      expect(
        RECEITA_ACF_IMOVEIS.parametrosDaBusca.safeParse({ finalidade: "aluguelxyz" }).success,
      ).toBe(false);
      expect(RECEITA_ACF_IMOVEIS.parametrosDaBusca.safeParse({ limite: 99 }).success).toBe(false);
      expect(RECEITA_ACF_IMOVEIS.parametrosDaBusca.safeParse({ quartos_min: 99 }).success).toBe(
        false,
      );
    });
  });

  describe("o SQL montado", () => {
    it("(a) só campos: LEFT JOIN em tudo, sem junção obrigatória", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(FIXOS_SO_CAMPOS, {}, 5);
      expect(sql).toContain("post_type = ?");
      expect(sql).toContain("post_status = ?");
      expect(valores).toContain("imovel");
      expect(valores).toContain("publish");
      // Nenhuma junção obrigatória: todo campo mapeado entra por LEFT JOIN.
      // (Tirar os "left join" do texto e ver se sobra alguma "join" solta.)
      expect(sql.replace(/left join/gi, "")).not.toMatch(/\bjoin\b/i);
      expect(sql.match(/left join/gi)?.length).toBe(3);
      // Sem categoria, as tabelas de termos não aparecem no SQL.
      expect(sql).not.toContain("term_relationships");
      expect(sql).not.toContain("term_taxonomy");
      expect(sql).not.toContain("wp_terms");
    });

    it("(b) só taxonomia: a categoria sai pela subconsulta do group_concat", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(FIXOS_SO_TAXONOMIA, {}, 5);
      expect(sql).toContain("group_concat");
      expect(sql).toContain("separator ', '");
      expect(sql).toContain("tt.taxonomy = ?");
      // O nível entra no SQL: bairro = filho (parent <> 0), cidade = raiz (parent = 0).
      expect(sql).toContain("tt.parent <> 0");
      expect(sql).toContain("tt.parent = 0");
      // Os slugs são VALORES, nunca identificadores no texto.
      expect(sql).not.toContain("localizacao");
      expect(sql).not.toContain("tipo_imovel");
      expect(valores).toContain("localizacao");
      expect(valores).toContain("tipo_imovel");
      expect(sql.split("?").length - 1).toBe(valores.length);
    });

    it("(c) misto: campo e categoria no mesmo SQL", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(FIXOS_MISTO, {}, 5);
      expect(sql).toContain("mpreco.meta_value");
      expect(sql).toContain("group_concat");
      expect(sql).toContain("not exists");
      expect(sql.split("?").length - 1).toBe(valores.length);
      const tabelas = RECEITA_ACF_IMOVEIS.tabelas(FIXOS_MISTO);
      expect(() => validarConsultaDeReceita(sql, tabelas)).not.toThrow();
    });

    it("todo meta_key e todo slug entra como valor (?) — nunca como identificador no texto", () => {
      // Nomes com sufixo próprio: se algum deles aparecesse CRU no SQL, a
      // concatenação passaria despercebida (o nome do dado também aparece no
      // SQL, como apelido da coluna de saída — por isso o sufixo).
      const fixosRaros = {
        prefixo: "wp_",
        post_type: "imovel",
        campos: {
          codigo: "cod_x9",
          preco: "preco_x9",
          aluguel: "alug_x9",
          condominio: "cond_x9",
          quartos: "quart_x9",
          suites: "suite_x9",
          banheiros: "banh_x9",
          vagas: "vag_x9",
          area: "area_x9",
        },
        taxonomias: {
          bairro: { taxonomia: "loc_x9" },
          cidade: { taxonomia: "loc_x9" },
        },
      };
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
        fixosRaros,
        { bairro: "centro", cidade: "sorocaba" },
        5,
      );
      for (const cru of [
        "cod_x9",
        "preco_x9",
        "alug_x9",
        "cond_x9",
        "quart_x9",
        "suite_x9",
        "banh_x9",
        "vag_x9",
        "area_x9",
        "loc_x9",
      ]) {
        expect(sql).not.toContain(cru);
      }
      expect(sql).not.toContain("meta_key = '");
      expect(sql).not.toContain("taxonomy = '");
      expect(sql.split("?").length - 1).toBe(valores.length);
      // E os valores estão todos ligados.
      for (const valor of ["cod_x9", "preco_x9", "alug_x9", "loc_x9"]) {
        expect(valores).toContain(valor);
      }
    });

    it("placeholders estão alinhados com os valores na ordem do texto", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
        FIXOS_MISTO,
        { bairro: "centro", quartos_min: 2, preco_max: 600000, limite: 3 },
        3,
      );
      const texto = renderizar(sql, valores);
      expect(texto).toContain("post_type = 'imovel'");
      expect(texto).toContain("post_status = 'publish'");
      expect(texto).toContain("meta_key = 'preco'");
      expect(texto).toContain("meta_key = 'quartos'");
      expect(texto).toContain("tt.taxonomy = 'localizacao'");
      expect(texto).toContain("limit 3");
    });

    it("o filtro de categoria é um exists (não multiplica a linha do imóvel)", () => {
      const { sql } = RECEITA_ACF_IMOVEIS.montar(
        FIXOS_SO_TAXONOMIA,
        { bairro: "centro", cidade: "sorocaba" },
        5,
      );
      expect(sql).toContain("exists (select 1 from");
      expect(sql).toContain("tr.object_id = p.ID");
      // Bairro e cidade casam pelo PEDÇO do texto (a pessoa digita "centro").
      expect(sql).toContain("lower(t.name) like ? escape '!'");
    });

    it("a finalidade casa por IGUALDADE (o termo É venda/aluguel, não um pedaço)", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
        FIXOS_SO_TAXONOMIA,
        { finalidade: "aluguel" },
        5,
      );
      // Igualdade no NOME ou no SLUG: o slug é "venda"/"aluguel" e o nome
      // costuma ser "Venda"/"Aluguel".
      expect(sql).toContain("lower(t.name) = ? or lower(t.slug) = ?");
      // SEM o "%": um termo "Venda e Aluguel" não é "aluguel", e com o LIKE
      // ele casava com os dois.
      expect(sql).not.toContain("%aluguel%");
      expect(valores).toContain("aluguel");
      expect(sql.split("?").length - 1).toBe(valores.length);
    });

    it("o filtro de um dado que é CAMPO é o LIKE de sempre", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
        { ...FIXOS_SO_CAMPOS, campos: { ...FIXOS_SO_CAMPOS.campos, bairro: "bairro" } },
        { bairro: "asa norte" },
        5,
      );
      expect(sql).toContain("lower(mbairro.meta_value) like ? escape '!'");
      expect(valores).toContain("%asa norte%");
    });

    it("quartos e vagas comparam como número (CAST)", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
        FIXOS_MISTO,
        { quartos_min: 2, vagas_min: 1 },
        5,
      );
      expect(sql).toContain("CAST(mquartos.meta_value AS DECIMAL(10,2)) >= ?");
      expect(sql).toContain("CAST(mvagas.meta_value AS DECIMAL(10,2)) >= ?");
      expect(valores).toContain(2);
      expect(valores).toContain(1);
    });

    it("preco_max e aluguel_max usam a conversão robusta do preço", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
        FIXOS_MISTO,
        { preco_max: 600000, aluguel_max: 3000 },
        5,
      );
      expect(sql).toContain("CASE");
      expect(sql).toContain("REGEXP");
      expect(sql.match(/\) <= \?/g)?.length).toBe(2);
      expect(valores).toContain(600000);
      expect(valores).toContain(3000);
      expect(sql).not.toContain("600000");
    });

    it("a situação esconde o imóvel: not exists sobre o campo da situação", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(FIXOS_MISTO, {}, 5);
      expect(sql).toContain("not exists (select 1 from");
      expect(sql).toContain("lower(msituacao.meta_value) in (?, ?)");
      expect(valores).toContain("situacao");
      expect(valores).toContain("vendido");
      expect(valores).toContain("alugado");
      // A ordem dos `?`: o campo antes da lista de valores.
      const texto = renderizar(sql, valores);
      expect(texto).toContain("meta_key = 'situacao'");
      expect(texto).toContain("in ('vendido', 'alugado')");
    });

    it("sem situação configurada, nenhum imóvel é escondido", () => {
      const { sql } = RECEITA_ACF_IMOVEIS.montar(FIXOS_SO_CAMPOS, {}, 5);
      expect(sql).not.toContain("not exists");
    });

    it("a saída traz só as colunas mapeadas, na ordem do contrato", () => {
      const { sql } = RECEITA_ACF_IMOVEIS.montar(FIXOS_SO_CAMPOS, {}, 5);
      expect(sql).toContain("p.ID as id");
      expect(sql).toContain("p.post_title as titulo");
      expect(sql).toContain("as preco");
      expect(sql).toContain("as aluguel");
      expect(sql).toContain("as quartos");
      expect(sql).toContain("p.guid as link");
      // O que não foi mapeado não sai.
      expect(sql).not.toContain("as codigo");
      expect(sql).not.toContain("as suites");
      expect(sql).not.toContain("as bairro");
    });

    it("o SQL passa no validador com as tabelas permitidas (e falha sem as de categoria)", () => {
      const { sql } = RECEITA_ACF_IMOVEIS.montar(FIXOS_SO_TAXONOMIA, {}, 5);
      const comCategoria = RECEITA_ACF_IMOVEIS.tabelas(FIXOS_SO_TAXONOMIA);
      expect(() => validarConsultaDeReceita(sql, comCategoria)).not.toThrow();
      // Sem as três tabelas de termos liberadas, a consulta é recusada.
      const semCategoria = RECEITA_ACF_IMOVEIS.tabelas(FIXOS_SO_CAMPOS);
      expect(() => validarConsultaDeReceita(sql, semCategoria)).toThrow();
    });
  });

  describe("as tabelas e colunas liberadas", () => {
    it("sem categoria mapeada, só posts e postmeta", () => {
      expect(RECEITA_ACF_IMOVEIS.tabelas(FIXOS_SO_CAMPOS)).toEqual(["wp_posts", "wp_postmeta"]);
      expect(Object.keys(RECEITA_ACF_IMOVEIS.colunas(FIXOS_SO_CAMPOS))).toEqual([
        "wp_posts",
        "wp_postmeta",
      ]);
    });

    it("com categoria mapeada, as três tabelas de termos entram", () => {
      const tabelas = RECEITA_ACF_IMOVEIS.tabelas(FIXOS_MISTO);
      expect(tabelas).toContain("wp_terms");
      expect(tabelas).toContain("wp_term_taxonomy");
      expect(tabelas).toContain("wp_term_relationships");
      const colunas = RECEITA_ACF_IMOVEIS.colunas(FIXOS_MISTO);
      expect(colunas["wp_terms"]).toContain("name");
      expect(colunas["wp_terms"]).toContain("slug");
      expect(colunas["wp_term_taxonomy"]).toContain("parent");
      expect(colunas["wp_term_relationships"]).toContain("object_id");
    });

    it("o prefixo entra nas tabelas (o site pode ter outro prefixo)", () => {
      const fixos = { ...FIXOS_SO_CAMPOS, prefixo: "loja_" };
      expect(RECEITA_ACF_IMOVEIS.tabelas(fixos)).toEqual(["loja_posts", "loja_postmeta"]);
    });
  });

  describe("a guarda da foto", () => {
    it("nenhuma foto: sem _thumbnail_id, sem attachment e sem imagem_url", () => {
      const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
        FIXOS_MISTO,
        { bairro: "centro", preco_max: 600000, limite: 5 },
        5,
      );
      expect(sql).not.toContain("_thumbnail_id");
      expect(sql).not.toContain("imagem_url");
      expect(sql).not.toContain("attachment");
      expect(valores).not.toContain("_thumbnail_id");
      expect(valores).not.toContain("attachment");
    });
  });

  it("as categorias da tela são as mesmas da receita", () => {
    // A tela (ReceitasProntas.tsx) lista as categorias num mapa próprio: se um
    // lado mudar sozinho, oMappings da tela e o SQL divergem.
    expect([...DADOS_DE_CATEGORIA]).toEqual(["bairro", "cidade", "tipo", "finalidade"]);
  });
});
