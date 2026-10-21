/**
 * Spec 25, item 8 — integração da receita `acf-imoveis` contra um MySQL 8 de
 * verdade (job `mysql-integracao`, NÃO roda aqui).
 *
 * O seed é uma IMOBILIÁRIA PEQUENA, no formato REAL de um site WordPress:
 *
 *  - bairro e cidade são CATEGORIAS (taxonomia hierárquica `localizacao`:
 *    Sorocaba › Centro, Campolim, Jardim; Votorantim › Centro) — não campos;
 *  - `tipo_imovel` (Casa, Apartamento) e `finalidade` (Venda, Aluguel) também
 *    são categorias;
 *  - o preço, o aluguel, os quartos e a situação são CAMPOS (meta_key);
 *  - há imóvel só de ALUGUEL (sem preço de venda) e imóvel VENDIDO;
 *  - os imóveis existem nos DOIS formatos: ACF (meta + par `_campo`) e
 *    JetEngine no modo padrão (meta simples, outro `post_type`).
 *
 * Cada caso obrigatório prova uma das quatro causas de a receita devolver
 * ZERO imóveis num cadastro realista:
 *  1. bairro só em categoria;
 *  2. preço é obrigatório na receita antiga — imóvel só de aluguel sumia;
 *  3. a situação não era filtrada — imóvel vendido era oferecido;
 *  4. tipo e finalidade não eram lidos.
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

/** root.query pode devolver RowDataPacket[] (SELECT) ou [RowDataPacket[], ResultSetHeader] (tupla). Normaliza. */
function extrairLinhas<T = unknown>(resultado: unknown): T[] {
  const arr = Array.isArray(resultado) ? (resultado as unknown[]) : [resultado];
  const primeiro = arr[0];
  return Array.isArray(primeiro) ? (primeiro as T[]) : (arr as T[]);
}

async function criarTabelasWP(root: Root, banco: string): Promise<void> {
  const q = (sql: string) => root.query(sql);
  // O collation é o do WordPress real (utf8mb4_unicode_520_ci) em TODAS as
  // tabelas: um collation diferente entre elas faria o MySQL recusar a
  // comparação de string.
  await q(`
    create table \`${banco}\`.\`${WP_PREFIXO}posts\` (
      ID bigint unsigned not null auto_increment,
      post_title varchar(200) not null default '',
      post_type varchar(20) not null default 'post',
      post_status varchar(20) not null default 'publish',
      guid varchar(255) not null default '',
      primary key (ID)
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_520_ci;
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
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_520_ci;
  `);
  // As três tabelas de CATEGORIA, com o DDL real do WordPress 6.x.
  await q(`
    CREATE TABLE \`${banco}\`.\`${WP_PREFIXO}terms\` (\`term_id\` bigint unsigned NOT NULL AUTO_INCREMENT, \`name\` varchar(200) NOT NULL DEFAULT '',
      \`slug\` varchar(200) NOT NULL DEFAULT '', \`term_group\` bigint NOT NULL DEFAULT '0', PRIMARY KEY (\`term_id\`),
      KEY \`slug\` (\`slug\`(191)), KEY \`name\` (\`name\`(191))) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
  `);
  await q(`
    CREATE TABLE \`${banco}\`.\`${WP_PREFIXO}term_taxonomy\` (\`term_taxonomy_id\` bigint unsigned NOT NULL AUTO_INCREMENT, \`term_id\` bigint unsigned NOT NULL DEFAULT '0',
      \`taxonomy\` varchar(32) NOT NULL DEFAULT '', \`description\` longtext NOT NULL, \`parent\` bigint unsigned NOT NULL DEFAULT '0',
      \`count\` bigint NOT NULL DEFAULT '0', PRIMARY KEY (\`term_taxonomy_id\`), UNIQUE KEY \`term_id_taxonomy\` (\`term_id\`,\`taxonomy\`),
      KEY \`taxonomy\` (\`taxonomy\`)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
  `);
  await q(`
    CREATE TABLE \`${banco}\`.\`${WP_PREFIXO}term_relationships\` (\`object_id\` bigint unsigned NOT NULL DEFAULT '0', \`term_taxonomy_id\` bigint unsigned NOT NULL DEFAULT '0',
      \`term_order\` int NOT NULL DEFAULT '0', PRIMARY KEY (\`object_id\`,\`term_taxonomy_id\`), KEY \`term_taxonomy_id\` (\`term_taxonomy_id\`))
      DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
  `);
}

/** A taxonomia da imobiliária: cidade › bairro, mais tipo e finalidade. */
const TERMOS: { nome: string; slug: string; taxonomia: string; pai?: string }[] = [
  { nome: "Sorocaba", slug: "sorocaba", taxonomia: "localizacao" },
  { nome: "Centro", slug: "sorocaba-centro", taxonomia: "localizacao", pai: "sorocaba" },
  { nome: "Campolim", slug: "sorocaba-campolim", taxonomia: "localizacao", pai: "sorocaba" },
  { nome: "Jardim", slug: "sorocaba-jardim", taxonomia: "localizacao", pai: "sorocaba" },
  { nome: "Votorantim", slug: "votorantim", taxonomia: "localizacao" },
  { nome: "Centro", slug: "votorantim-centro", taxonomia: "localizacao", pai: "votorantim" },
  { nome: "Casa", slug: "casa", taxonomia: "tipo_imovel" },
  { nome: "Apartamento", slug: "apartamento", taxonomia: "tipo_imovel" },
  { nome: "Venda", slug: "venda", taxonomia: "finalidade" },
  { nome: "Aluguel", slug: "aluguel", taxonomia: "finalidade" },
];

/**
 * Os imóveis. `metas` é o que o site grava; `termos` são os slugs das
 * categorias; `acf` = escreve o par `_campo` (formato ACF) em vez da linha
 * simples (formato JetEngine no modo padrão).
 */
const IMOVEIS: {
  titulo: string;
  postType?: string;
  status?: string;
  acf: boolean;
  metas: Record<string, string>;
  termos: string[];
}[] = [
  {
    titulo: "Casa Centro Sorocaba",
    acf: true,
    metas: {
      codigo: "IM-001",
      preco: "350000",
      quartos: "3",
      banheiros: "2",
      vagas: "2",
      area: "120",
      condominio: "450",
      situacao: "disponivel",
    },
    termos: ["sorocaba-centro", "sorocaba", "casa", "venda"],
  },
  {
    titulo: "Apartamento Centro Votorantim",
    acf: true,
    metas: { codigo: "IM-002", preco: "480000", quartos: "2", area: "65", situacao: "disponivel" },
    termos: ["votorantim-centro", "votorantim", "apartamento", "venda"],
  },
  {
    titulo: "Casa Campolim",
    acf: true,
    metas: {
      codigo: "IM-003",
      preco: "650.000,00",
      quartos: "4",
      suites: "1",
      area: "200",
      situacao: "disponivel",
    },
    termos: ["sorocaba-campolim", "sorocaba", "casa", "venda"],
  },
  {
    // IMÓVEL SÓ DE ALUGUEL: não tem preço de venda. A receita antiga exigia
    // preço por JOIN interno e este imóvel sumia da lista inteira.
    titulo: "Sala Comercial para Aluguel",
    acf: true,
    metas: { codigo: "IM-004", aluguel: "3.500,00", quartos: "1", area: "40", situacao: "disponivel" },
    termos: ["sorocaba-centro", "sorocaba", "apartamento", "aluguel"],
  },
  {
    // IMÓVEL VENDIDO: a situação esconde — a receita antiga ofereceria este.
    titulo: "Cobertura Vendida",
    acf: true,
    metas: { codigo: "IM-005", preco: "900000", quartos: "4", area: "300", situacao: "vendido" },
    termos: ["sorocaba-centro", "sorocaba", "casa", "venda"],
  },
  {
    // DOIS termos na MESMA taxonomia (bairro): tem que sair UMA vez.
    titulo: "Casa Dois Bairros",
    acf: true,
    metas: { codigo: "IM-006", preco: "420000", quartos: "3", area: "140", situacao: "disponivel" },
    termos: ["sorocaba-centro", "sorocaba-campolim", "sorocaba", "casa", "venda"],
  },
  {
    titulo: "Apartamento Preço Americano",
    acf: true,
    metas: { codigo: "IM-007", preco: "650,000.00", quartos: "2", area: "70", situacao: "disponivel" },
    termos: ["sorocaba-jardim", "sorocaba", "apartamento", "venda"],
  },
  {
    titulo: "Apartamento Símbolo",
    acf: true,
    metas: { codigo: "IM-008", preco: "R$ 780.000,00", quartos: "2", area: "60", situacao: "disponivel" },
    termos: ["sorocaba-jardim", "sorocaba", "apartamento", "venda"],
  },
  {
    titulo: "Casa Preço Sob Consulta",
    acf: true,
    metas: { codigo: "IM-009", preco: "Consulte", quartos: "2", area: "80", situacao: "disponivel" },
    termos: ["sorocaba-jardim", "sorocaba", "casa", "venda"],
  },
  {
    titulo: "Apartamento Milhar",
    acf: true,
    metas: { codigo: "IM-010", preco: "1.200.000", quartos: "3", area: "90", situacao: "disponivel" },
    termos: ["sorocaba-jardim", "sorocaba", "apartamento", "venda"],
  },
  {
    titulo: "Apartamento Decimal",
    acf: true,
    metas: { codigo: "IM-011", preco: "650000.50", quartos: "2", area: "75", situacao: "disponivel" },
    termos: ["sorocaba-jardim", "sorocaba", "apartamento", "venda"],
  },
  {
    titulo: "Rascunho Invisível",
    status: "draft",
    acf: true,
    metas: { codigo: "IM-012", preco: "350000", quartos: "2", situacao: "disponivel" },
    termos: ["sorocaba-centro", "sorocaba", "casa", "venda"],
  },
  {
    titulo: "Artigo do Blog",
    postType: "post",
    acf: true,
    metas: { codigo: "IM-013", preco: "1000", quartos: "1", situacao: "disponivel" },
    termos: ["sorocaba-centro", "sorocaba", "casa", "venda"],
  },
  {
    // O MESMO cadastro no JetEngine no modo padrão: linhas simples em
    // `wp_postmeta` (sem o par `_campo`) e outro tipo de post.
    titulo: "Casa Jet Centro",
    postType: "imovel_jet",
    acf: false,
    metas: { codigo: "IM-JET-001", preco: "300000", quartos: "2", area: "90", situacao: "disponivel" },
    termos: ["sorocaba-centro", "sorocaba", "casa", "venda"],
  },
];

/** Os fixos da receita: campos + categorias + a situação que esconde o vendido. */
const FIXOS = {
  prefixo: WP_PREFIXO,
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
    tipo: { taxonomia: "tipo_imovel" },
    finalidade: { taxonomia: "finalidade" },
  },
  situacao: { campo: "situacao", ocultar: ["vendido", "alugado"] },
};

async function semeiaImobiliaria(root: Root, banco: string): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => root.query(sql, params);

  // ── 1. As categorias ──────────────────────────────────────────────────────
  const termIdPorSlug = new Map<string, number>();
  for (const termo of TERMOS) {
    await q(
      `insert into \`${banco}\`.\`${WP_PREFIXO}terms\` (name, slug) values (?, ?)`,
      [termo.nome, termo.slug],
    );
    const id = Number(
      (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
        ?.id ?? 0,
    );
    termIdPorSlug.set(termo.slug, id);
  }

  const ttIdPorSlug = new Map<string, number>();
  for (const termo of TERMOS) {
    const termId = termIdPorSlug.get(termo.slug)!;
    const pai = termo.pai ? termIdPorSlug.get(termo.pai)! : 0;
    await q(
      `insert into \`${banco}\`.\`${WP_PREFIXO}term_taxonomy\` (term_id, taxonomy, description, parent, count) values (?, ?, '', ?, 0)`,
      [termId, termo.taxonomia, pai],
    );
    const id = Number(
      (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
        ?.id ?? 0,
    );
    ttIdPorSlug.set(termo.slug, id);
  }

  // ── 2. Os imóveis (post + meta + categorias) ─────────────────────────────
  for (const imovel of IMOVEIS) {
    const postType = imovel.postType ?? "imovel";
    const status = imovel.status ?? "publish";
    await q(
      `insert into \`${banco}\`.\`${WP_PREFIXO}posts\` (post_title, post_type, post_status, guid) values (?, ?, ?, ?)`,
      [imovel.titulo, postType, status, `http://imoveis.exemplo/?p=${imovel.titulo}`],
    );
    const postId = Number(
      (extrairLinhas<{ id: number }>(await q(`select LAST_INSERT_ID() as id`))[0] as { id: number })
        ?.id ?? 0,
    );

    for (const [chave, valor] of Object.entries(imovel.metas)) {
      await q(
        `insert into \`${banco}\`.\`${WP_PREFIXO}postmeta\` (post_id, meta_key, meta_value) values (?, ?, ?)`,
        [postId, chave, valor],
      );
      // O ACF grava o par: o campo e o `_campo` (o nome do campo no grupo).
      if (imovel.acf) {
        await q(
          `insert into \`${banco}\`.\`${WP_PREFIXO}postmeta\` (post_id, meta_key, meta_value) values (?, ?, ?)`,
          [postId, `_${chave}`, `${chave}_${postId}`],
        );
      }
    }

    for (const slug of imovel.termos) {
      await q(
        `insert into \`${banco}\`.\`${WP_PREFIXO}term_relationships\` (object_id, term_taxonomy_id) values (?, ?)`,
        [postId, ttIdPorSlug.get(slug)!],
      );
    }
  }
}

describe("receita acf-imoveis contra MySQL 8 de verdade", () => {
  beforeAll(async () => {
    root = await conectarComoRoot();
    banco = await novoBanco(root, "acf-imoveis");
    await criarTabelasWP(root, banco);
    await semeiaImobiliaria(root, banco);
  });

  afterAll(async () => {
    await apagarBanco(root, banco);
    await root.end().catch(() => undefined);
  });

  /** Executa o SQL montado pela receita contra o MySQL de verdade. */
  async function consultar(
    busca: Record<string, unknown>,
    limite = 5,
    fixos: unknown = FIXOS,
  ): Promise<Record<string, unknown>[]> {
    const pool = obterPoolMysql(conexaoDe(banco, { sslMode: "disable" }));
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(fixos, busca, limite);
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
      return linhas as Record<string, unknown>[];
    } finally {
      conexao.release();
    }
  }

  const titulos = (linhas: Record<string, unknown>[]) =>
    linhas.map((l) => String(l.titulo ?? ""));

  it("mede o DDL e as tabelas criadas", async () => {
    const tabelas = extrairLinhas<{ table_name: string }>(
      await root.query(
        `select table_name as table_name from information_schema.tables where table_schema = ?`,
        [banco],
      ),
    );
    registrar("C1-acf-imoveis", `tabelas: ${tabelas.map((t) => t.table_name).join(", ")}`);
    expect(tabelas.map((t) => t.table_name).sort()).toEqual(
      [
        `${WP_PREFIXO}posts`,
        `${WP_PREFIXO}postmeta`,
        `${WP_PREFIXO}terms`,
        `${WP_PREFIXO}term_taxonomy`,
        `${WP_PREFIXO}term_relationships`,
      ].sort(),
    );
  });

  it("monta SQL e passa no validador com as tabelas permitidas", () => {
    const { sql, valores } = RECEITA_ACF_IMOVEIS.montar(FIXOS, {}, 5);
    const tabelas = RECEITA_ACF_IMOVEIS.tabelas(FIXOS);
    expect(() => validarConsultaDeReceita(sql, tabelas)).not.toThrow();
    expect(valores).toContain("imovel");
    expect(valores).toContain("publish");
    expect(valores).toContain("localizacao");
    expect(sql.split("?").length - 1).toBe(valores.length);
  });

  it("CAUSA 1 — bairro só em categoria: a busca acha o imóvel do bairro", async () => {
    const linhas = await consultar({ bairro: "campolim" });
    registrar("C1-acf-imoveis-bairro-categoria", `bairro 'campolim' → ${titulos(linhas).join(", ")}`);
    expect(titulos(linhas)).toContain("Casa Campolim");
    expect(titulos(linhas)).not.toContain("Casa Centro Sorocaba");
  });

  it("CAUSA 2 — imóvel só de aluguel aparece no aluguel e some no preço máximo", async () => {
    const noAluguel = await consultar({ finalidade: "aluguel" });
    registrar("C1-acf-imoveis-finalidade-aluguel", `finalidade 'aluguel' → ${titulos(noAluguel).join(", ")}`);
    expect(titulos(noAluguel)).toContain("Sala Comercial para Aluguel");
    // O mesmo imóvel, com teto de PREÇO: sem preço de venda, ele não entra.
    const noPreco = await consultar({ preco_max: 600000 });
    expect(titulos(noPreco)).not.toContain("Sala Comercial para Aluguel");
    // E o filtro de ALUGUEL o traz (o aluguel é 3.500,00).
    const ate3500 = await consultar({ aluguel_max: 3500 });
    expect(titulos(ate3500)).toContain("Sala Comercial para Aluguel");
    const ate3000 = await consultar({ aluguel_max: 3000 });
    expect(titulos(ate3000)).not.toContain("Sala Comercial para Aluguel");
  });

  it("CAUSA 3 — imóvel vendido nunca aparece", async () => {
    const linhas = await consultar({});
    registrar("C1-acf-imoveis-vendido", `sem filtro → ${titulos(linhas).join(", ")}`);
    expect(titulos(linhas)).not.toContain("Cobertura Vendida");
    // Nem quando o filtro é largo.
    const largos = await consultar({ preco_max: 2000000 }, 20);
    expect(titulos(largos)).not.toContain("Cobertura Vendida");
  });

  it("CAUSA 4 — tipo e finalidade filtram pela categoria", async () => {
    const casas = await consultar({ tipo: "casa" }, 20);
    registrar("C1-acf-imoveis-tipo", `tipo 'casa' → ${titulos(casas).join(", ")}`);
    expect(titulos(casas).length).toBeGreaterThan(0);
    for (const linha of casas) {
      expect(String(linha.tipo)).toContain("Casa");
      expect(String(linha.tipo)).not.toContain("Apartamento");
    }

    const paraVenda = await consultar({ finalidade: "venda" }, 20);
    registrar("C1-acf-imoveis-finalidade-venda", `finalidade 'venda' → ${titulos(paraVenda).join(", ")}`);
    expect(titulos(paraVenda).length).toBeGreaterThan(0);
    for (const linha of paraVenda) {
      expect(String(linha.finalidade)).toContain("Venda");
    }
    // A finalidade casa pelo SLUG do termo ("venda"), não só pelo nome.
    const porSlug = await consultar({ finalidade: "venda" }, 20);
    expect(titulos(porSlug)).toContain("Casa Centro Sorocaba");
  });

  it("nível: o bairro acha o Centro de Sorocaba e o de Votorantim; a cidade, só o dela", async () => {
    const centros = await consultar({ bairro: "centro" }, 20);
    registrar("C1-acf-imoveis-nivel-bairro", `bairro 'centro' → ${titulos(centros).join(", ")}`);
    expect(titulos(centros)).toContain("Casa Centro Sorocaba");
    expect(titulos(centros)).toContain("Apartamento Centro Votorantim");

    const votorantim = await consultar({ cidade: "votorantim" }, 20);
    registrar("C1-acf-imoveis-nivel-cidade", `cidade 'votorantim' → ${titulos(votorantim).join(", ")}`);
    expect(titulos(votorantim)).toEqual(["Apartamento Centro Votorantim"]);
  });

  it("rascunho e outro post_type nunca aparecem", async () => {
    const linhas = await consultar({}, 20);
    expect(titulos(linhas)).not.toContain("Rascunho Invisível");
    expect(titulos(linhas)).not.toContain("Artigo do Blog");
  });

  it("o imóvel com DOIS termos na mesma taxonomia aparece UMA vez", async () => {
    const linhas = await consultar({ bairro: "centro" }, 20);
    const doisBairros = linhas.filter((l) => l.titulo === "Casa Dois Bairros");
    registrar(
      "C1-acf-imoveis-dois-termos",
      `Casa Dois Bairros: ${doisBairros.length} linha(s), bairro='${doisBairros[0]?.bairro ?? ""}'`,
    );
    expect(doisBairros).toHaveLength(1);
    // Os dois nomes de bairro estão na MESMA célula (group_concat).
    expect(String(doisBairros[0]?.bairro)).toContain("Centro");
    expect(String(doisBairros[0]?.bairro)).toContain("Campolim");
  });

  it("o JetEngine no modo padrão (meta simples, outro post_type) funciona igual", async () => {
    const fixosJet = { ...FIXOS, post_type: "imovel_jet" };
    const linhas = await consultar({ bairro: "centro" }, 20, fixosJet);
    registrar("C1-acf-imoveis-jetengine", `JetEngine → ${titulos(linhas).join(", ")}`);
    expect(titulos(linhas)).toEqual(["Casa Jet Centro"]);
    // E a mesma configuração não acha o imóvel do ACF (são tipos de post diferentes).
    const doAcf = await consultar({ bairro: "centro" }, 20);
    expect(titulos(doAcf)).not.toContain("Casa Jet Centro");
  });

  it("os formatos de preço continuam valendo (o reparo anterior)", async () => {
    const brasileiro = await consultar({ bairro: "campolim" });
    const linhaBrasileira = brasileiro.find((l) => l.titulo === "Casa Campolim");
    expect(linhaBrasileira).toBeDefined();
    expect(Number(linhaBrasileira!.preco)).toBe(650000);

    const americano = await consultar({ bairro: "jardim", preco_max: 1000 });
    expect(titulos(americano)).not.toContain("Apartamento Preço Americano");
    const americano2 = await consultar({ bairro: "jardim", preco_max: 700000 });
    const linhaAmericana = americano2.find((l) => l.titulo === "Apartamento Preço Americano");
    expect(linhaAmericana).toBeDefined();
    expect(Number(linhaAmericana!.preco)).toBe(650000);

    const simbolo = await consultar({ bairro: "jardim", preco_max: 300000 });
    expect(titulos(simbolo)).not.toContain("Apartamento Símbolo");
    const simbolo2 = await consultar({ bairro: "jardim", preco_max: 800000 });
    const linhaSimbolo = simbolo2.find((l) => l.titulo === "Apartamento Símbolo");
    expect(linhaSimbolo).toBeDefined();
    expect(Number(linhaSimbolo!.preco)).toBe(780000);

    const semNumero = await consultar({ bairro: "jardim" });
    const linhaSemNumero = semNumero.find((l) => l.titulo === "Casa Preço Sob Consulta");
    expect(linhaSemNumero).toBeDefined();
    expect(linhaSemNumero!.preco ?? null).toBeNull();

    const milhar = await consultar({ bairro: "jardim", preco_max: 1300000 });
    const linhaMilhar = milhar.find((l) => l.titulo === "Apartamento Milhar");
    expect(linhaMilhar).toBeDefined();
    expect(Number(linhaMilhar!.preco)).toBe(1200000);

    const decimal = await consultar({ bairro: "jardim", preco_max: 650001 });
    const linhaDecimal = decimal.find((l) => l.titulo === "Apartamento Decimal");
    expect(linhaDecimal).toBeDefined();
    expect(Number(linhaDecimal!.preco)).toBe(650000.5);
  });

  it("fonte_nao_liberada quando a categoria está mapeada e a tabela de termos não foi liberada", async () => {
    const regra = {
      modo: "list" as const,
      fontes: [
        { schema: banco, tabela: `${WP_PREFIXO}posts`, colunas: null, descricao: "" },
        { schema: banco, tabela: `${WP_PREFIXO}postmeta`, colunas: null, descricao: "" },
        { schema: banco, tabela: `${WP_PREFIXO}terms`, colunas: null, descricao: "" },
        { schema: banco, tabela: `${WP_PREFIXO}term_taxonomy`, colunas: null, descricao: "" },
        // `term_relationships` DE FORA: é a tabela que amarra o imóvel ao termo.
      ],
    };
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
          tabelas: RECEITA_ACF_IMOVEIS.tabelas(FIXOS),
          colunasPorTabela: RECEITA_ACF_IMOVEIS.colunas(FIXOS),
        },
        { limiteMax: 5 },
      ),
    ).rejects.toBeInstanceOf(FonteNaoLiberadaError);
  });
});
