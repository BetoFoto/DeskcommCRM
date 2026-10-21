/**
 * Spec 25, item 8 — integração da receita `acf-imoveis` contra um
 * MySQL 8 de verdade (job `mysql-integracao`, NÃO roda aqui).
 *
 * Copia o DDL do WordPress 6.x (tabelas `wp_posts` e `wp_postmeta`).
 * Versão de referência: WordPress 6.7.
 *
 * Semeia imóveis do tipo `imovel` com pares ACF (`preco`/`_preco`…):
 *  1. rascunho (post_status = 'draft') — nunca deve aparecer
 *  2. publicado, preço "650.000,00" (formato com ponto e vírgula)
 *  3. publicado, preço "480000" (formato puro)
 *  4. bairro "Asa Norte", quartos 2
 *  5. bairro "Centro", quartos 3
 *  6. bairro "Centro_ Norte" (underscore LITERAL no valor)
 *  7. bairro "100% Center" (sinal de porcentagem LITERAL no valor)
 *  Mais 1 post de outro tipo (`post`) com os mesmos campos — NUNCA aparece.
 *  13. publicado, preço "650,000.00" (formato AMERICANO: vírgula = milhar,
 *      ponto = decimal) — o mesmo valor do item 2 escrito do outro jeito.
 *
 * Casos: bairro (case-insensitive), bairro com `_`/`%` literais (não viram
 * coringa), quartos_min, preco_max (os formatos brasileiro, americano, puro
 * e decimal), limite, rascunho invisível, outro post_type invisível,
 * mapeamento com nomes diferentes (valor/dormitorios), fonte_nao_liberada em
 * modo `list`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarDialetoDeLeitura, FonteNaoLiberadaError } from "@/lib/external-db/dialeto";
import { obterPoolMysql } from "@/lib/external-db/dialetos/mysql/conexao";
import { RECEITA_ACF_IMOVEIS } from "@/lib/external-db/receitas/acf-imoveis";
import { validarConsultaDeReceita } from "@/lib/external-db/receitas/validador";

import { apagarBanco, conectarComoRoot, conexaoDe, novoBanco, registrar } from "./ajudante";
import type { Root } from "./ajudante";

let root: Root;
let banco: string;

const WP_PREFIXO = "wp_";

/** root.query pode retornar RowDataPacket[] (SELECT) ou [RowDataPacket[], ResultSetHeader] (tupla). Normaliza. */
function extrairLinhas<T = unknown>(resultado: unknown): T[] {
  const arr = Array.isArray(resultado) ? (resultado as unknown[]) : [resultado];
  const primeiro = arr[0];
  return Array.isArray(primeiro) ? (primeiro as T[]) : (arr as T[]);
}

async function criarTabelasWP(root: Root, banco: string): Promise<void> {
  const q = (sql: string) => root.query(sql);
  await q(`
    create table \`${banco}\`.\`${WP_PREFIXO}posts\` (
      ID bigint unsigned not null auto_increment,
      post_title varchar(200) not null default '',
      post_type varchar(20) not null default 'post',
      post_status varchar(20) not null default 'publish',
      guid varchar(255) not null default '',
      primary key (ID)
    ) engine=InnoDB character set utf8mb4;
  `);
  await q(`
    create table \`${banco}\`.\`${WP_PREFIXO}postmeta\` (
      meta_id bigint unsigned not null auto_increment,
      post_id bigint unsigned not null,
      meta_key varchar(255) default null,
      meta_value longtext default null,
      primary key (meta_id),
      key post_id (post_id),
      key meta_key (meta_key(191))
    ) engine=InnoDB character set utf8mb4;
  `);
}

/** Os fixos da receita: prefixo, tipo de post e o mapeamento de meta_key. */
const FIXOS = {
  prefixo: WP_PREFIXO,
  post_type: "imovel",
  campos: { preco: "preco", quartos: "quartos", bairro: "bairro" },
};

async function semeiaImoveis(root: Root, banco: string): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => root.query(sql, params);

  // 1. rascunho (nunca aparece)
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Rascunho invisível', 'imovel', 'draft', 'http://imoveis.exemplo/?p=1')`,
  );
  const idRascunho = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 1,
  );

  // 2. publicado, preço "650.000,00" (formato brasileiro)
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Apartamento Asa Norte', 'imovel', 'publish', 'http://imoveis.exemplo/?p=2')`,
  );
  const idAsaNorte = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 2,
  );

  // 3. publicado, preço "480000" (formato puro)
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Casa Centro', 'imovel', 'publish', 'http://imoveis.exemplo/?p=3')`,
  );
  const idCentro = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 3,
  );

  // 4. publicado, bairro "Asa Norte", quartos 2
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Apartamento 2 quartos', 'imovel', 'publish', 'http://imoveis.exemplo/?p=4')`,
  );
  const idDoisQuartos = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 4,
  );

  // 5. publicado, bairro "Centro", quartos 3
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Casa 3 quartos', 'imovel', 'publish', 'http://imoveis.exemplo/?p=5')`,
  );
  const idTresQuartos = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 5,
  );

  // 6. outro post_type (post) com mesmos campos — NUNCA deve aparecer
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Artigo do blog', 'post', 'publish', 'http://blog.exemplo/?p=1')`,
  );
  const idBlog = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 6,
  );

  // 7. publicado, bairro com UNDERSCORE LITERAL ("Centro_ Norte")
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Casa com underscore no bairro', 'imovel', 'publish', 'http://imoveis.exemplo/?p=7')`,
  );
  const idUnderscore = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 7,
  );

  // 8. publicado, bairro com PORCENTAGEM LITERAL ("100% Center")
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Casa com porcentagem no bairro', 'imovel', 'publish', 'http://imoveis.exemplo/?p=8')`,
  );
  const idPorcentagem = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 8,
  );

  // 9. publicado, preço "650000.50" (ponto decimal, 2 dígitos no fim)
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Cobertura com ponto decimal', 'imovel', 'publish', 'http://imoveis.exemplo/?p=9')`,
  );
  const idPontoDecimal = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 9,
  );

  // 10. publicado, preço "1.200.000" (pontos = milhar, sem vírgula) → deve virar 1200000
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Casa com pontos milhar', 'imovel', 'publish', 'http://imoveis.exemplo/?p=10')`,
  );
  const idMilhar = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 10,
  );

  // 11. publicado, preço COM símbolo "R$ 650.000,00": o CAST cru dava 0 e passava em todo teto
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Casa com símbolo de moeda', 'imovel', 'publish', 'http://imoveis.exemplo/?p=11')`,
  );
  const idSimbolo = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })?.id ?? 11,
  );

  // 12. publicado, preço sem número nenhum ("Consulte"): vira NULL, nunca 0
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Casa preço sob consulta', 'imovel', 'publish', 'http://imoveis.exemplo/?p=12')`,
  );
  const idSobConsulta = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })?.id ?? 12,
  );

  // 13. publicado, preço "650,000.00" (formato AMERICANO: vírgula = milhar,
  // ponto = decimal). O MESMO valor do item 2 escrito do outro jeito: lido
  // como 650 ele passaria em teto de 1.000 e o imóvel apareceria "de graça".
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values ('Apartamento com preço americano', 'imovel', 'publish', 'http://imoveis.exemplo/?p=13')`,
  );
  const idAmericano = Number(
    (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
      ?.id ?? 13,
  );

  // metas ACF (par meta_key / _meta_key)
  await q(
    `insert into \`${banco}\`.\`${WP_PREFIXO}postmeta\` (post_id, meta_key, meta_value) values
      (${idRascunho}, '_preco', 'preco_50'),
      (${idRascunho}, 'preco', '50.000,00'),
      (${idRascunho}, '_quartos', 'quartos_2'),
      (${idRascunho}, 'quartos', '2'),
      (${idRascunho}, '_bairro', 'bairro_rascunho'),
      (${idRascunho}, 'bairro', 'Bairro Rascunho'),
      (${idAsaNorte}, '_preco', 'preco_650'),
      (${idAsaNorte}, 'preco', '650.000,00'),
      (${idAsaNorte}, '_quartos', 'quartos_3'),
      (${idAsaNorte}, 'quartos', '3'),
      (${idAsaNorte}, '_bairro', 'bairro_asa_norte'),
      (${idAsaNorte}, 'bairro', 'Asa Norte'),
      (${idCentro}, '_preco', 'preco_480'),
      (${idCentro}, 'preco', '480000'),
      (${idCentro}, '_quartos', 'quartos_2'),
      (${idCentro}, 'quartos', '2'),
      (${idCentro}, '_bairro', 'bairro_centro'),
      (${idCentro}, 'bairro', 'Centro'),
      (${idDoisQuartos}, '_preco', 'preco_300'),
      (${idDoisQuartos}, 'preco', '300000'),
      (${idDoisQuartos}, '_quartos', 'quartos_2'),
      (${idDoisQuartos}, 'quartos', '2'),
      (${idDoisQuartos}, '_bairro', 'bairro_asul'),
      (${idDoisQuartos}, 'bairro', 'Asa Sul'),
      (${idTresQuartos}, '_preco', 'preco_700'),
      (${idTresQuartos}, 'preco', '700000'),
      (${idTresQuartos}, '_quartos', 'quartos_3'),
      (${idTresQuartos}, 'quartos', '3'),
      (${idTresQuartos}, '_bairro', 'bairro_lago'),
      (${idTresQuartos}, 'bairro', 'Lago Sul'),
      (${idBlog}, '_preco', 'preco_blog'),
      (${idBlog}, 'preco', '1000'),
      (${idBlog}, '_quartos', 'quartos_blog'),
      (${idBlog}, 'quartos', '1'),
      (${idBlog}, '_bairro', 'bairro_blog'),
      (${idBlog}, 'bairro', 'Blog Bairro'),
      (${idUnderscore}, '_preco', 'preco_underscore'),
      (${idUnderscore}, 'preco', '320000'),
      (${idUnderscore}, '_quartos', 'quartos_underscore'),
      (${idUnderscore}, 'quartos', '2'),
      (${idUnderscore}, '_bairro', 'bairro_underscore'),
      (${idUnderscore}, 'bairro', 'Centro_ Norte'),
      (${idPorcentagem}, '_preco', 'preco_porcentagem'),
      (${idPorcentagem}, 'preco', '310000'),
      (${idPorcentagem}, '_quartos', 'quartos_porcentagem'),
      (${idPorcentagem}, 'quartos', '2'),
      (${idPorcentagem}, '_bairro', 'bairro_porcentagem'),
      (${idPorcentagem}, 'bairro', '100% Center'),
      (${idPontoDecimal}, '_preco', 'preco_decimal'),
      (${idPontoDecimal}, 'preco', '650000.50'),
      (${idPontoDecimal}, '_quartos', 'quartos_decimal'),
      (${idPontoDecimal}, 'quartos', '4'),
      (${idPontoDecimal}, '_bairro', 'bairro_decimal'),
      (${idPontoDecimal}, 'bairro', 'Bairro Decimal'),
      (${idMilhar}, '_preco', 'preco_milhar'),
      (${idMilhar}, 'preco', '1.200.000'),
      (${idMilhar}, '_quartos', 'quartos_milhar'),
      (${idMilhar}, 'quartos', '3'),
      (${idMilhar}, '_bairro', 'bairro_milhar'),
      (${idMilhar}, 'bairro', 'Bairro Milhar'),
      (${idSimbolo}, '_preco', 'preco_simbolo'),
      (${idSimbolo}, 'preco', 'R$ 650.000,00'),
      (${idSimbolo}, '_quartos', 'quartos_simbolo'),
      (${idSimbolo}, 'quartos', '3'),
      (${idSimbolo}, '_bairro', 'bairro_simbolo'),
      (${idSimbolo}, 'bairro', 'Bairro Simbolo'),
      (${idSobConsulta}, '_preco', 'preco_consulta'),
      (${idSobConsulta}, 'preco', 'Consulte'),
      (${idSobConsulta}, '_quartos', 'quartos_consulta'),
      (${idSobConsulta}, 'quartos', '2'),
      (${idSobConsulta}, '_bairro', 'bairro_consulta'),
      (${idSobConsulta}, 'bairro', 'Bairro Consulta'),
      (${idAmericano}, '_preco', 'preco_americano'),
      (${idAmericano}, 'preco', '650,000.00'),
      (${idAmericano}, '_quartos', 'quartos_americano'),
      (${idAmericano}, 'quartos', '2'),
      (${idAmericano}, '_bairro', 'bairro_americano'),
      (${idAmericano}, 'bairro', 'Americano')`,
  );
}

describe("receita acf-imoveis contra MySQL 8 de verdade", () => {
  beforeAll(async () => {
    root = await conectarComoRoot();
    banco = await novoBanco(root, "acf-imoveis");
    await criarTabelasWP(root, banco);
    await semeiaImoveis(root, banco);
  });

  afterAll(async () => {
    await apagarBanco(root, banco);
    await root.end().catch(() => undefined);
  });

  /** Executa o SQL montado pela receita contra o MySQL de verdade. */
  async function consultar(
    busca: Record<string, unknown>,
    limite = 5,
  ): Promise<{ titulo: string; preco: unknown; bairro: string }[]> {
    const pool = obterPoolMysql(conexaoDe(banco, { sslMode: "disable" }));
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(FIXOS, busca, limite);
    const conexao = await pool.getConnection();
    try {
      await conexao.query("START TRANSACTION READ ONLY");
      await conexao.query("SET SESSION max_execution_time = 10000");
      await conexao.query("SET SESSION lock_wait_timeout = 5");
      const [linhas] = await conexao.execute(
        sql,
        valores.map((v: unknown) => (v === undefined ? null : v)),
      );
      await conexao.query("COMMIT");
      return linhas as { titulo: string; preco: unknown; bairro: string }[];
    } finally {
      conexao.release();
    }
  }

  it("mede o DDL e as tabelas criadas", async () => {
    const tabelas = extrairLinhas<{ table_name: string }>(
      await root.query(
        `select table_name as table_name from information_schema.tables where table_schema = ?`,
        [banco],
      ),
    );
    registrar("C1-acf-imoveis", `tabelas: ${tabelas.map((t) => t.table_name).join(", ")}`);
    expect(tabelas.map((t) => t.table_name).sort()).toEqual(
      [`${WP_PREFIXO}posts`, `${WP_PREFIXO}postmeta`].sort(),
    );
  });

  it("monta SQL e passa no validador com as tabelas permitidas", () => {
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(FIXOS, {}, 5);
    const tabelas = RECEITA_ACF_IMOVEIS.tabelas(WP_PREFIXO);
    expect(() => validarConsultaDeReceita(sql, tabelas)).not.toThrow();
    expect(valores).toContain("imovel");
    expect(valores).toContain("publish");
    expect(valores).toContain("preco");
    expect(valores).toContain("quartos");
    expect(valores).toContain("bairro");
    expect(sql.split("?").length - 1).toBe(valores.length);
  });

  it("executa e devolve só imóveis publicados do tipo imovel", async () => {
    const linhas = await consultar({});
    const titulos = linhas.map((l) => l.titulo);
    registrar("C1-acf-imoveis-executa", `títulos: ${titulos.join(", ")}`);
    expect(titulos).toContain("Apartamento Asa Norte");
    expect(titulos).toContain("Casa Centro");
    expect(titulos).toContain("Apartamento 2 quartos");
    expect(titulos).toContain("Casa 3 quartos");
    expect(titulos).not.toContain("Rascunho invisível");
    expect(titulos).not.toContain("Artigo do blog");
  });

  it("bairro filtra sem diferenciar maiúsculas e minúsculas", async () => {
    const titulos = (await consultar({ bairro: "ASA NORTE" })).map((l) => l.titulo);
    registrar("C1-acf-imoveis-bairro", `bairro 'ASA NORTE' → ${titulos.join(", ")}`);
    expect(titulos).toContain("Apartamento Asa Norte");
    expect(titulos).not.toContain("Casa Centro");
  });

  it("bairro com _ e % literais NÃO viram curinga", async () => {
    // "_" casa só o literal: "Centro_ Norte". Sem o escape, "_" traria tudo.
    const comUnderscore = (await consultar({ bairro: "_" })).map((l) => l.titulo);
    registrar("C1-acf-imoveis-bairro-underscore", `bairro '_' → ${comUnderscore.join(", ")}`);
    expect(comUnderscore).toEqual(["Casa com underscore no bairro"]);

    // "%" casa só o literal: "100% Center".
    const comPorcentagem = (await consultar({ bairro: "%" })).map((l) => l.titulo);
    registrar("C1-acf-imoveis-bairro-porcentagem", `bairro '%' → ${comPorcentagem.join(", ")}`);
    expect(comPorcentagem).toEqual(["Casa com porcentagem no bairro"]);

    // O prefixo "Centro_" casa o imóvel do underscore e NÃO o "Centro" puro.
    const comPrefixo = (await consultar({ bairro: "centro_" })).map((l) => l.titulo);
    expect(comPrefixo).toEqual(["Casa com underscore no bairro"]);
  });

  it("quartos_min filtra imóveis com pelo menos N quartos", async () => {
    const titulos = (await consultar({ quartos_min: 3 })).map((l) => l.titulo);
    registrar("C1-acf-imoveis-quartos_min", `quartos_min=3 → ${titulos.join(", ")}`);
    expect(titulos).toContain("Casa 3 quartos");
    expect(titulos).toContain("Apartamento Asa Norte"); // 3 quartos
    expect(titulos).not.toContain("Apartamento 2 quartos");
    expect(titulos).not.toContain("Casa Centro"); // 2 quartos
  });

  it("preco_max aceita '650.000,00' (formato brasileiro) e '480000' (puro)", async () => {
    // preco_max = 600000: pega Casa Centro (480000), Casa 3 quartos (700000 não), Apartamento 2 quartos (300000)
    const titulos = (await consultar({ preco_max: 600000 })).map((l) => l.titulo);
    registrar("C1-acf-imoveis-preco_max_600k", `preco_max=600000 → ${titulos.join(", ")}`);
    expect(titulos).toContain("Casa Centro"); // 480000
    expect(titulos).toContain("Apartamento 2 quartos"); // 300000
    expect(titulos).not.toContain("Apartamento Asa Norte"); // 650000 > 600000
    expect(titulos).not.toContain("Casa 3 quartos"); // 700000 > 600000
  });

  it("preço com símbolo ('R$ 650.000,00') vale 650000, e preço sem número não passa em teto nenhum", async () => {
    // Teto de 300000: o imóvel de R$ 650.000,00 NÃO pode entrar (antes virava 0 e entrava).
    const ate300 = (await consultar({ preco_max: 300000 })).map((l) => l.titulo);
    registrar("C1-acf-imoveis-preco_simbolo_300k", `preco_max=300000 → ${ate300.join(", ")}`);
    expect(ate300).not.toContain("Casa com símbolo de moeda");
    expect(ate300).not.toContain("Casa preço sob consulta");
    expect(ate300).toContain("Apartamento 2 quartos");

    // Teto de 700000: o símbolo entra (650000 <= 700000); o sem número continua de fora.
    const ate700 = (await consultar({ preco_max: 700000, bairro: "Simbolo" })).map((l) => l.titulo);
    expect(ate700).toEqual(["Casa com símbolo de moeda"]);
    expect((await consultar({ preco_max: 700000, bairro: "Consulta" })).length).toBe(0);

    // Na listagem sem filtro de preço, o sem número aparece com preço ausente (NULL), não 0.
    const semNumero = (await consultar({ bairro: "Consulta" }))[0];
    expect(semNumero?.preco ?? null).toBeNull();
  });

  it("preco_max trata ponto decimal: '650000.50' → 650000.5", async () => {
    // O bairro isola o imóvel: sem ele, o teto de 5 linhas cortaria a cobertura
    // e o teste passaria pelo motivo errado.
    // preco_max = 650000: NÃO pega o imóvel com 650000.50 (é maior)
    const titulos = (await consultar({ preco_max: 650000, bairro: "decimal" })).map((l) => l.titulo);
    registrar(
      "C1-acf-imoveis-preco_max_decimal_650k",
      `preco_max=650000 → ${titulos.join(", ")}`,
    );
    expect(titulos).not.toContain("Cobertura com ponto decimal"); // 650000.50 > 650000

    // preco_max = 650001: pega o imóvel com 650000.50 (é menor)
    const titulos2 = (await consultar({ preco_max: 650001, bairro: "decimal" })).map((l) => l.titulo);
    registrar(
      "C1-acf-imoveis-preco_max_decimal_650k1",
      `preco_max=650001 → ${titulos2.join(", ")}`,
    );
    expect(titulos2).toEqual(["Cobertura com ponto decimal"]); // 650000.50 <= 650001
  });

  it("preco_max trata o formato americano '650,000.00' como 650000 (não como 650)", async () => {
    // O bairro isola o imóvel: sem ele, o teto de 5 linhas cortaria a lista
    // e o teste passaria pelo motivo errado.
    // preco_max = 1000: NÃO pega o imóvel (650000 > 1000). Com a leitura
    // errada (650.00) ele entrava e aparecia "de graça".
    const ate1k = await consultar({ preco_max: 1000, bairro: "Americano" });
    registrar(
      "C1-acf-imoveis-preco_max_americano_1k",
      `preco_max=1000 → ${ate1k.map((l) => l.titulo).join(", ")}`,
    );
    expect(ate1k.map((l) => l.titulo)).not.toContain("Apartamento com preço americano");

    // preco_max = 700000: pega o imóvel (650000 <= 700000).
    const ate700k = await consultar({ preco_max: 700000, bairro: "Americano" });
    registrar(
      "C1-acf-imoveis-preco_max_americano_700k",
      `preco_max=700000 → ${ate700k.map((l) => l.titulo).join(", ")}`,
    );
    expect(ate700k.map((l) => l.titulo)).toEqual(["Apartamento com preço americano"]);
    // A coluna preco devolvida vale 650000 (o MySQL devolve DECIMAL como texto).
    expect(Number(ate700k[0]!.preco)).toBe(650000);
  });

  it("preco_max trata '1.200.000' como 1200000 (pontos milhar, sem vírgula)", async () => {
    // preco_max = 1000000: NÃO pega o imóvel com 1.200.000 (1200000 > 1000000)
    const titulos = (await consultar({ preco_max: 1000000, bairro: "milhar" })).map((l) => l.titulo);
    registrar("C1-acf-imoveis-preco_max_1m", `preco_max=1000000 → ${titulos.join(", ")}`);
    expect(titulos).not.toContain("Casa com pontos milhar"); // 1200000 > 1000000

    // preco_max = 1300000: pega o imóvel com 1.200.000 (1200000 <= 1300000)
    const linhas = await consultar({ preco_max: 1300000, bairro: "milhar" });
    registrar(
      "C1-acf-imoveis-preco_max_1m3",
      `preco_max=1300000 → ${linhas.map((l) => l.titulo).join(", ")}`,
    );
    expect(linhas.map((l) => l.titulo)).toContain("Casa com pontos milhar"); // 1200000 <= 1300000
    // A coluna preco devolvida vale 1200000.
    const casaMilhar = linhas.find((l) => l.titulo === "Casa com pontos milhar");
    expect(casaMilhar).toBeDefined();
    expect(Number(casaMilhar!.preco)).toBe(1200000); // o MySQL devolve DECIMAL como texto ("1200000.00")

    // Confere que "480000" segue em 480000.
    const linhas480 = await consultar({ preco_max: 480000 });
    const casaCentro = linhas480.find((l) => l.titulo === "Casa Centro");
    expect(casaCentro).toBeDefined();
    expect(Number(casaCentro!.preco)).toBe(480000);
  });

  it("limite corta a quantidade de linhas", async () => {
    const linhas = await consultar({}, 2);
    expect(linhas.length).toBeLessThanOrEqual(2);
  });

  it("rascunho nunca aparece (post_status = publish)", async () => {
    const titulos = (await consultar({})).map((l) => l.titulo);
    expect(titulos).not.toContain("Rascunho invisível");
  });

  it("outro post_type (post) nunca aparece", async () => {
    const titulos = (await consultar({})).map((l) => l.titulo);
    expect(titulos).not.toContain("Artigo do blog");
  });

  it("mapeamento com nomes diferentes (valor/dormitorios) funciona", async () => {
    // O mesmo banco, mas a receita usa meta_key "valor" e "dormitorios" em vez de "preco"/"quartos".
    // Para isso criamos cópias das metas com nomes alternativos num prefixo diferente.
    const ALT_PREFIXO = "loja_";
    await root.query(
      `create table \`${banco}\`.\`${ALT_PREFIXO}posts\` like \`${banco}\`.\`${WP_PREFIXO}posts\``,
    );
    await root.query(
      `create table \`${banco}\`.\`${ALT_PREFIXO}postmeta\` like \`${banco}\`.\`${WP_PREFIXO}postmeta\``,
    );
    // Copia só os posts do tipo imovel publicados.
    await root.query(
      `insert into \`${banco}\`.\`${ALT_PREFIXO}posts\` select * from \`${banco}\`.\`${WP_PREFIXO}posts\` where post_type = 'imovel' and post_status = 'publish'`,
    );
    // Copia as metas, renomeando preco->valor e quartos->dormitorios.
    await root.query(
      `insert into \`${banco}\`.\`${ALT_PREFIXO}postmeta\` (post_id, meta_key, meta_value)
       select post_id,
         case meta_key when 'preco' then 'valor' when 'quartos' then 'dormitorios' else meta_key end,
         meta_value
       from \`${banco}\`.\`${WP_PREFIXO}postmeta\`
       where post_id in (select ID from \`${banco}\`.\`${ALT_PREFIXO}posts\`)`,
    );
    const pool = obterPoolMysql(conexaoDe(banco, { sslMode: "disable" }));
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(
      {
        prefixo: ALT_PREFIXO,
        post_type: "imovel",
        campos: { preco: "valor", quartos: "dormitorios", bairro: "bairro" },
      },
      { preco_max: 600000 },
      5,
    );
    const conexao = await pool.getConnection();
    try {
      await conexao.query("START TRANSACTION READ ONLY");
      await conexao.query("SET SESSION max_execution_time = 10000");
      await conexao.query("SET SESSION lock_wait_timeout = 5");
      const [linhas] = await conexao.execute(
        sql,
        valores.map((v: unknown) => (v === undefined ? null : v)),
      );
      await conexao.query("COMMIT");
      const titulos = (linhas as { titulo: string }[]).map((l) => l.titulo);
      registrar("C1-acf-imoveis-mapeamento", `valor/dormitorios → ${titulos.join(", ")}`);
      expect(titulos).toContain("Casa Centro"); // 480000 <= 600000
      expect(titulos).toContain("Apartamento 2 quartos"); // 300000 <= 600000
    } finally {
      conexao.release();
    }
    await root.query(`drop table if exists \`${banco}\`.\`${ALT_PREFIXO}posts\``);
    await root.query(`drop table if exists \`${banco}\`.\`${ALT_PREFIXO}postmeta\``);
  });

  it("fonte_nao_liberada em modo list quando a tabela da receita não está na lista", async () => {
    const regra = { modo: "list" as const, fontes: [] };
    const d = criarDialetoDeLeitura(
      {
        listarTabelas: async () => [],
        descreverTabela: async () => null,
        lerTabela: async () => ({ colunas: [], linhas: [], limite: 5, offset: 0 }),
        schemaDasReceitas: () => banco,
        executarReceita: async () => ({
          colunas: [],
          linhas: [],
          limite: 5,
          offset: 0,
          truncado: false,
        }),
      },
      regra,
    );
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(FIXOS, {}, 5);
    await expect(
      d.executarReceita(
        {
          sql,
          valores,
          tabelas: RECEITA_ACF_IMOVEIS.tabelas(WP_PREFIXO),
          colunasPorTabela: RECEITA_ACF_IMOVEIS.colunas(WP_PREFIXO),
        },
        { limiteMax: 5 },
      ),
    ).rejects.toBeInstanceOf(FonteNaoLiberadaError);
  });
});
