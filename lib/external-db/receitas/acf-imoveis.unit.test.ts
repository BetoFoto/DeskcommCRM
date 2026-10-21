/**
 * Teste unitário da receita `acf-imoveis` SEM MySQL de verdade.
 *
 * Prova que o SQL montado pela receita:
 *  - filtra `post_type = ?` e `post_status = 'publish'` (rascunho nunca entra),
 *  - coloca todo `meta_key` como VALOR (`?`), nunca como identificador no texto,
 *  - converte preço robustamente ("650.000,00", "650,000.00" e "480000" viram número no SQL),
 *  - valida prefixo, post_type e meta_key com regex (Zod recusa invalidos),
 *  - placeholders alinhados com valores na ordem do texto (R-A),
 *  - NÃO traz foto (a imagem_url é da R4 — ver a guarda no fim do arquivo).
 */
import { describe, expect, it } from "vitest";

import { RECEITA_ACF_IMOVEIS } from "./acf-imoveis";
import { validarConsultaDeReceita } from "./validador";

describe("receita acf-imoveis (unit, sem MySQL)", () => {
  const fixos = {
    prefixo: "wp_",
    post_type: "imovel",
    campos: { preco: "preco", quartos: "quartos", bairro: "bairro" },
  };

  it("monta SQL com post_type = ? e post_status = 'publish'", () => {
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(fixos, {}, 5);
    expect(sql).toContain("post_type = ?");
    expect(valores).toContain("imovel");
    expect(sql).toContain("post_status = ?");
    expect(valores).toContain("publish");
    const tabelas = RECEITA_ACF_IMOVEIS.tabelas("wp_");
    expect(() => validarConsultaDeReceita(sql, tabelas)).not.toThrow();
  });

  /**
   * Meta_key fora do padrão de nome: se algum deles aparecesse CRU no texto do
   * SQL, a concatenação passaria despercebida. A asserção antiga
   * (`not.toContain("preco =")`) pegava o nome do CAMPO, não o da meta_key —
   * e o SQL tem `mpreco.meta_key = ?`, que ela não via.
   */
  it("todo meta_key entra como valor (?) — nunca como identificador no texto", () => {
    const fixosRaros = {
      prefixo: "wp_",
      post_type: "imovel",
      campos: { preco: "valor_x9", quartos: "dorm_x9", bairro: "bair_x9" },
    };
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
      fixosRaros,
      { bairro: "asa norte", quartos_min: 2, preco_max: 600000, limite: 3 },
      3,
    );
    // Nenhum meta_key cru no texto do SQL (meta_key colada no SQL é concatenação).
    expect(sql).not.toContain("valor_x9");
    expect(sql).not.toContain("dorm_x9");
    expect(sql).not.toContain("bair_x9");
    // Nenhuma meta_key literal (entre aspas) no texto do SQL.
    expect(sql).not.toContain("meta_key = '");
    // Toda junção compara a meta_key com PLACEHOLDER — uma por campo mapeado.
    const juncoes = sql.match(/\.meta_key = \?/g) ?? [];
    expect(juncoes).toHaveLength(3);
    // Todo valor virou placeholder.
    expect(sql.split("?").length - 1).toBe(valores.length);
    // As três meta_key dos JOINs obrigatórios estão entre os valores.
    expect(valores).toContain("valor_x9");
    expect(valores).toContain("dorm_x9");
    expect(valores).toContain("bair_x9");
  });

  it("placeholders estão alinhados com os valores na ordem do texto (R-A)", () => {
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
      fixos,
      { bairro: "asa norte", quartos_min: 2, preco_max: 600000, limite: 3 },
      3,
    );

    // Render: substitui cada `?` pelo valor correspondente, em sequência.
    const partes = sql.split("?");
    if (partes.length - 1 !== valores.length) {
      throw new Error(`esperava ${valores.length} placeholders, achou ${partes.length - 1}`);
    }
    let renderizado = "";
    for (let i = 0; i < partes.length; i++) {
      renderizado += partes[i];
      if (i < valores.length) {
        const v = valores[i];
        renderizado += typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v);
      }
    }

    // Cada meta_key dos JOINs recebe o seu próprio valor.
    expect(renderizado).toContain("meta_key = 'preco'");
    expect(renderizado).toContain("meta_key = 'quartos'");
    expect(renderizado).toContain("meta_key = 'bairro'");
    // As cláusulas do WHERE recebem os valores de filtro.
    expect(renderizado).toContain("post_type = 'imovel'");
    expect(renderizado).toContain("post_status = 'publish'");
    expect(renderizado).toContain("limit 3");
  });

  it("conta de ? bate com o número de valores", () => {
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(fixos, {}, 5);
    expect(sql.split("?").length - 1).toBe(valores.length);
  });

  it("Zod recusa prefixo inválido", () => {
    expect(() =>
      RECEITA_ACF_IMOVEIS.parametrosFixos.parse({
        prefixo: "wp; drop table",
        post_type: "imovel",
        campos: { preco: "preco", quartos: "quartos", bairro: "bairro" },
      }),
    ).toThrow();
  });

  it("Zod recusa post_type inválido", () => {
    expect(() =>
      RECEITA_ACF_IMOVEIS.parametrosFixos.parse({
        prefixo: "wp_",
        post_type: "Imóvel", // maiúscula não é permitida
        campos: { preco: "preco", quartos: "quartos", bairro: "bairro" },
      }),
    ).toThrow();
  });

  it("Zod recusa meta_key inválida (preco com ; drop)", () => {
    expect(() =>
      RECEITA_ACF_IMOVEIS.parametrosFixos.parse({
        prefixo: "wp_",
        post_type: "imovel",
        campos: { preco: "preco; drop table", quartos: "quartos", bairro: "bairro" },
      }),
    ).toThrow();
  });

  it("Zod aceita campos opcionais ausentes", () => {
    const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
      prefixo: "wp_",
      post_type: "imovel",
      campos: { preco: "preco", quartos: "quartos", bairro: "bairro" },
    });
    expect(parseado.success).toBe(true);
  });

  it("Zod aceita cidade/area/finalidade opcionais", () => {
    const parseado = RECEITA_ACF_IMOVEIS.parametrosFixos.safeParse({
      prefixo: "wp_",
      post_type: "imovel",
      campos: {
        preco: "valor",
        quartos: "dormitorios",
        bairro: "bairro",
        cidade: "cidade",
        area: "area",
        finalidade: "finalidade",
      },
    });
    expect(parseado.success).toBe(true);
  });

  it("monta com campos opcionais mapeados", () => {
    const fixosComOpcionais = {
      prefixo: "wp_",
      post_type: "imovel",
      campos: {
        preco: "valor",
        quartos: "dormitorios",
        bairro: "bairro",
        cidade: "cidade",
        area: "area_m2",
      },
    };
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
      fixosComOpcionais,
      { cidade: "asa norte", preco_max: 600000, limite: 5 },
      5,
    );
    expect(sql).toContain("left join");
    expect(valores).toContain("cidade");
    expect(valores).toContain("area_m2");
    expect(sql.split("?").length - 1).toBe(valores.length);
  });

  /**
   * O `preco_max` é um FILTRO: o teto viaja como valor (placeholder) e o SQL
   * compara o CASE do preço com ele. A asserção antiga (`toContain("meta_value")`)
   * só provava que o preço aparecia no SELECT — passava com o filtro inteiro
   * fora do SQL.
   */
  it("SQL com preco_max monta CASE para conversão robusta e filtra pelo TETO (placeholder)", () => {
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(fixos, { preco_max: 600000 }, 5);
    expect(sql).toContain("CASE");
    expect(sql).toContain("DECIMAL(10,2)");
    // O teto é VALOR: ele não aparece no texto do SQL (nem colado, nem cru).
    expect(sql).not.toContain("600000");
    expect(valores).toContain(600000);
    // O filtro existe: no WHERE, o CASE do preço é comparado com o placeholder.
    const iWhere = sql.indexOf("where ");
    expect(iWhere).toBeGreaterThan(-1);
    const where = sql.slice(iWhere);
    expect(where).toContain(") <= ?");
    expect(where).not.toContain("600000");
    // Nenhum apelido órfão: não pode haver `m.meta_value` (apelido inexistente).
    expect(sql).not.toContain("m.meta_value");
  });

  /**
   * O REGEXP do preço usa classe de caractere `[.]`, que não depende de barra
   * invertida no SQL. Com `'\.[0-9]{1,2}$'` o MySQL descarta a barra e o ponto
   * passa a casar qualquer caractere, quebrando "1.200.000" (virava 1.2).
   */
  it("REGEXP do preço usa '[.]' sem barra invertida", () => {
    const { sql } = RECEITA_ACF_IMOVEIS.montar(fixos, { preco_max: 600000 }, 5);
    expect(sql).toContain("REGEXP '[.][0-9]{1,2}$'");
    // No trecho do preço (o CASE do preco_max), não pode haver barra invertida.
    const idx = sql.indexOf("CASE");
    const trechoPreco = sql.slice(idx, sql.indexOf("END", idx) + 3);
    expect(trechoPreco).not.toContain("\\");
  });

  /**
   * Todo apelido usado no SQL (`<apelido>.meta_value` ou `<apelido>.post_id`)
   * deve ser declarado numa junção `postmeta <apelido> on`.
   * Caso contrário o MySQL responde "Unknown column" em toda busca.
   */
  it("todo apelido usado no SQL foi declarado numa junção postmeta", () => {
    const fixosTodosCampos = {
      prefixo: "wp_",
      post_type: "imovel",
      campos: {
        preco: "preco",
        quartos: "quartos",
        bairro: "bairro",
        cidade: "cidade",
        area: "area",
        finalidade: "finalidade",
      },
    };
    const { sql } = RECEITA_ACF_IMOVEIS.montar(
      fixosTodosCampos,
      { bairro: "asa norte", quartos_min: 2, preco_max: 600000, cidade: "asa norte", limite: 5 },
      5,
    );

    // Remove crases para facilitar a extração de apelidos (o SQL quotado tem
    // `wp_postmeta`, não `postmeta` puro).
    const sqlSemCrase = sql.replace(/`/g, "");

    // Apelidos usados como <apelido>.meta_value no SELECT/WHERE.
    const apelidosUsados = new Set<string>();
    const reMetaValue = /([a-zA-Z_][a-zA-Z0-9_]*)\.meta_value/g;
    let m;
    while ((m = reMetaValue.exec(sqlSemCrase)) !== null) {
      apelidosUsados.add(m[1]!);
    }
    // Também post_id nas junções.
    const rePostId = /([a-zA-Z_][a-zA-Z0-9_]*)\.post_id/g;
    while ((m = rePostId.exec(sqlSemCrase)) !== null) {
      apelidosUsados.add(m[1]!);
    }

    // Apelidos declarados numa junção `postmeta <apelido> on`.
    const reJuncao = /postmeta\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+on/gi;
    const apelidosDeclarados = new Set<string>();
    while ((m = reJuncao.exec(sqlSemCrase)) !== null) {
      apelidosDeclarados.add(m[1]!);
    }

    for (const apelido of apelidosUsados) {
      expect(
        apelidosDeclarados.has(apelido),
        `apelido ${apelido} usado mas não declarado numa junção postmeta`,
      ).toBe(true);
    }
  });

  it("todo apelido usado no SQL foi declarado — receita sem campos opcionais", () => {
    // Apenas os 3 obrigatórios (preco, quartos, bairro), sem opcionais.
    const { sql } = RECEITA_ACF_IMOVEIS.montar(fixos, {}, 5);
    const sqlSemCrase = sql.replace(/`/g, "");

    const apelidosUsados = new Set<string>();
    const reMetaValue = /([a-zA-Z_][a-zA-Z0-9_]*)\.meta_value/g;
    let m;
    while ((m = reMetaValue.exec(sqlSemCrase)) !== null) {
      apelidosUsados.add(m[1]!);
    }
    const rePostId = /([a-zA-Z_][a-zA-Z0-9_]*)\.post_id/g;
    while ((m = rePostId.exec(sqlSemCrase)) !== null) {
      apelidosUsados.add(m[1]!);
    }

    const reJuncao = /postmeta\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+on/gi;
    const apelidosDeclarados = new Set<string>();
    while ((m = reJuncao.exec(sqlSemCrase)) !== null) {
      apelidosDeclarados.add(m[1]!);
    }

    for (const apelido of apelidosUsados) {
      expect(apelidosDeclarados.has(apelido), `apelido ${apelido} usado mas não declarado`).toBe(
        true,
      );
    }
  });

  /**
   * SEM FOTO nesta fatia (como na R1): a imagem_url é a R4. A receita não
   * junciona `_thumbnail_id` nem a tabela de anexos, e não devolve `imagem_url`.
   * A guarda existe para o dia em que a foto entrar: ela tem que ser uma
   * decisão, não um vazamento de uma fatia futura colada aqui.
   */
  it("nenhuma foto: sem _thumbnail_id, sem attachment e sem imagem_url", () => {
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
      fixos,
      { bairro: "asa norte", preco_max: 600000, limite: 5 },
      5,
    );
    expect(sql).not.toContain("_thumbnail_id");
    expect(sql).not.toContain("imagem_url");
    expect(sql).not.toContain("attachment");
    expect(valores).not.toContain("_thumbnail_id");
    expect(valores).not.toContain("attachment");
  });

  /**
   * O LIKE do bairro escapa os curingas: `_` e `%` do valor do cliente são
   * literais, nunca coringa. Sem o escape, "bairro = _" traria a linha toda.
   */
  it("o LIKE do bairro escapa _ e % do valor (não vira coringa)", () => {
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
      fixos,
      { bairro: "_" },
      5,
    );
    expect(sql).toContain("escape '!'");
    expect(valores).toContain("%!_%");
    const { sql: sql2, valores: valores2 } = RECEITA_ACF_IMOVEIS.montar(
      fixos,
      { bairro: "a_b%c" },
      5,
    );
    expect(valores2).toContain("%a!_b!%c%");
    expect(sql2).toContain("like ? escape '!'");
  });
});
