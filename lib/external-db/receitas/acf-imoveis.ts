/**
 * Receita `acf-imoveis`: imóveis de um site WordPress, uma linha por imóvel
 * publicado.
 *
 * O JOIN lê:
 *  - `<prefixo>posts` — post_type = (tipo do admin), post_status = 'publish'
 *  - `<prefixo>postmeta` — uma junção por CAMPO mapeado (preço, aluguel,
 *    quartos, área…). **LEFT JOIN**: nenhum campo é obrigatório, porque o
 *    cadastro de uma imobiliária real não tem o mesmo campo em todo imóvel —
 *    imóvel só de aluguel não tem preço de venda.
 *  - `<prefixo>terms`, `<prefixo>term_taxonomy`, `<prefixo>term_relationships` —
 *    as CATEGORIAS do site (bairro, cidade, tipo, finalidade). Entram só
 *    quando o administrador mapeou alguma categoria.
 *
 * **Por que a categoria é metade da receita.** Medido num WordPress real
 * (ACF 6.8.10 + JetEngine 3.5.8, MySQL 8.0.45), o cadastro típico de uma
 * imobiliária guarda bairro e cidade como CATEGORIA (taxonomia hierárquica
 * "Cidade › Bairro"), não como campo. Uma receita que só lê `meta_key` devolve
 * ZERO imóveis nesse cadastro: o bairro é obrigatório e não existe em campo.
 *
 * Por isso o bairro, a cidade, o tipo e a finalidade têm DUAS fontes possíveis
 * — campo (meta_key) OU categoria (taxonomia) — e o administrador escolhe uma.
 * O preço e o aluguel são sempre campo.
 *
 * O prefixo entra no SQL SOMENTE via quotar com crase, depois de validado pela
 * regex. Todo valor (meta_key, slug de taxonomia, filtros) vai por placeholder
 * `?`. Nunca concatenação.
 *
 * SEM FOTO nesta fatia (como na R1): a receita não traz `imagem_url` e não
 * junciona `_thumbnail_id` nem a tabela de anexos — a foto é a R4.
 */
import { z } from "zod";

import { precoNumero } from "./preco";
import { quotarIdentificadorMysql } from "./sql-mysql";
import {
  alvoDeLike,
  categoriaMapeada,
  clausulaDeTermo,
  colunasDaTaxonomia,
  DADOS_DE_CATEGORIA,
  subqueryDeTermos,
  tabelasDaTaxonomia,
  temCategoriaMapeada,
} from "./taxonomia";
import type {
  ContextoDeTaxonomia,
  DadoDeCategoria,
  TaxonomiasMapeadas,
} from "./taxonomia";
import type { DefinicaoDeReceita } from "./tipos";

const PREFIXO_PADRAO = "wp_";
const PREFIXO_REGEX = /^[A-Za-z0-9_]{1,20}$/;
const META_KEY_REGEX = /^[A-Za-z0-9_\-]{1,64}$/;
/** O `taxonomy` do WordPress é `varchar(32)`. */
const TAXONOMIA_REGEX = /^[a-z0-9_-]{1,32}$/;

/** O tipo de post padrão do WordPress quando o site usa ACF para imóveis. */
export const POST_TYPE_PADRAO = "imovel";

/** O tipo de post do WordPress: minúsculas, números, underscore e hífen. */
export const POST_TYPE_REGEX = /^[a-z0-9_\-]{1,20}$/;

/** Teto desta fatia: o C2 (custo em tokens de uma resposta de receita) não foi medido. */
export const TETO_ITENS_ACF_IMOVEIS = 5;

/**
 * Os dados que o site guarda como CAMPO (meta_key). Bairro, cidade, tipo e
 * finalidade NÃO entram aqui: eles podem ser categoria, e a escolha é do
 * administrador (ver `DADOS_DE_CATEGORIA`).
 */
export const DADOS_DE_CAMPO_IMOVEL = [
  "codigo",
  "preco",
  "aluguel",
  "condominio",
  "quartos",
  "suites",
  "banheiros",
  "vagas",
  "area",
] as const;

export type DadoDeCampo = (typeof DADOS_DE_CAMPO_IMOVEL)[number];

/** Todo dado que a receita sabe ler — campo ou categoria. */
export type DadoDoImoveis = DadoDeCampo | DadoDeCategoria;

/** O mapeamento de meta_key por dado que o administrador preenche na tela. */
export type CamposDaReceita = Partial<Record<DadoDoImoveis, string>>;

/** A situação do imóvel: o campo e os valores que devem sumir da lista. */
export interface SituacaoDaReceita {
  campo: string;
  ocultar: string[];
}

const prefixoSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(PREFIXO_REGEX, "Use apenas letras, números e underscore no prefixo.")
  .default(PREFIXO_PADRAO);

const postTypeSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(
    POST_TYPE_REGEX,
    "Use apenas letras minúsculas, números, underscore e hífen no tipo de post.",
  )
  .default(POST_TYPE_PADRAO);

const metaKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    META_KEY_REGEX,
    "Use apenas letras, números, underscore e hífen no nome do campo.",
  );

const slugDaTaxonomiaSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(
    TAXONOMIA_REGEX,
    "Use apenas letras minúsculas, números, underscore e hífen no nome da categoria.",
  );

/** O bairro: só o nível `filho` faz sentido (o bairro tem a cidade acima). */
const taxonomiaDeBairroSchema = z
  .object({
    taxonomia: slugDaTaxonomiaSchema,
    nivel: z.enum(["qualquer", "filho"]).optional().default("qualquer"),
  })
  .strict();

/** A cidade: só o nível `raiz` faz sentido (a cidade não tem cidade acima). */
const taxonomiaDeCidadeSchema = z
  .object({
    taxonomia: slugDaTaxonomiaSchema,
    nivel: z.enum(["qualquer", "raiz"]).optional().default("qualquer"),
  })
  .strict();

/** Tipo e finalidade não têm hierarquia: só o slug da taxonomia. */
const taxonomiaSimplesSchema = z
  .object({
    taxonomia: slugDaTaxonomiaSchema,
  })
  .strict();

const situacaoSchema = z
  .object({
    campo: metaKeySchema,
    ocultar: z
      .array(z.string().min(1).max(60))
      .min(1, "Escreva pelo menos um valor a esconder.")
      .max(10, "Escreva no máximo 10 valores a esconder.")
      .default(["vendido", "alugado"]),
  })
  .strict();

/**
 * A mensagem de "duas fontes" — uma frase ESTÁTICA por dado.
 *
 * Estática porque a tela a traduz: uma frase montada em runtime ("Escolha
 * uma fonte só para " + o nome do dado) não é chave de dicionário, e quem
 * escolheu o espanhol leria a mensagem em português.
 */
const FONTE_DUPLA: Record<DadoDeCategoria, string> = {
  bairro: "Escolha uma fonte só para o bairro: campo ou categoria.",
  cidade: "Escolha uma fonte só para a cidade: campo ou categoria.",
  tipo: "Escolha uma fonte só para o tipo: campo ou categoria.",
  finalidade: "Escolha uma fonte só para a finalidade: campo ou categoria.",
};

/** O que o admin preenche na tela: prefixo, tipo de post, campos, categorias e situação. */
export const PARAMETROS_FIXOS_ACF_IMOVEIS = z
  .object({
    prefixo: prefixoSchema,
    post_type: postTypeSchema,
    campos: z
      .object({
        codigo: metaKeySchema.optional(),
        preco: metaKeySchema.optional(),
        aluguel: metaKeySchema.optional(),
        condominio: metaKeySchema.optional(),
        quartos: metaKeySchema.optional(),
        suites: metaKeySchema.optional(),
        banheiros: metaKeySchema.optional(),
        vagas: metaKeySchema.optional(),
        area: metaKeySchema.optional(),
        bairro: metaKeySchema.optional(),
        cidade: metaKeySchema.optional(),
        tipo: metaKeySchema.optional(),
        finalidade: metaKeySchema.optional(),
      })
      .strict()
      .default({}),
    taxonomias: z
      .object({
        bairro: taxonomiaDeBairroSchema.optional(),
        cidade: taxonomiaDeCidadeSchema.optional(),
        tipo: taxonomiaSimplesSchema.optional(),
        finalidade: taxonomiaSimplesSchema.optional(),
      })
      .strict()
      .default({}),
    situacao: situacaoSchema.optional(),
  })
  .strict()
  .superRefine((fixos, ctx) => {
    // Um imóvel só de aluguel não tem preço de venda — mas a busca por preço
    // (e por aluguel) precisa de pelo menos um dos dois preços mapeados.
    if (!fixos.campos.preco && !fixos.campos.aluguel) {
      ctx.addIssue({
        code: "custom",
        path: ["campos"],
        message:
          "Informe o preço de venda, o aluguel, ou os dois. Sem um deles a busca não sabe filtrar por preço.",
      });
    }
    // Um dado tem UMA fonte: campo OU categoria. As duas juntas fariam a
    // receita ler o mesmo dado em dois lugares (e a busca filtrar pelos dois).
    for (const dado of DADOS_DE_CATEGORIA) {
      if (fixos.campos[dado] && fixos.taxonomias[dado]) {
        ctx.addIssue({
          code: "custom",
          path: ["taxonomias", dado],
          message: FONTE_DUPLA[dado],
        });
      }
    }
  });

/** O que o agente preenche na conversa. */
export const PARAMETROS_DA_BUSCA_ACF_IMOVEIS = z
  .object({
    /** Bairro (até 60 chars). LIKE com escape, sem diferenciar maiúsculas e minúsculas. */
    bairro: z.string().max(60).optional(),
    /** Cidade (até 60 chars). */
    cidade: z.string().max(60).optional(),
    /** Tipo de imóvel (até 60 chars): casa, apartamento, sala… */
    tipo: z.string().max(60).optional(),
    /** Para que o imóvel serve: venda ou aluguel. */
    finalidade: z.enum(["venda", "aluguel"]).optional(),
    /** Quartos mínimos (0..20). */
    quartos_min: z.number().int().min(0).max(20).optional(),
    /** Vagas de garagem mínimas (0..20). */
    vagas_min: z.number().int().min(0).max(20).optional(),
    /** Preço de venda máximo (≥ 0). O meta_value pode vir "650.000,00", "650,000.00" ou "480000". */
    preco_max: z.number().nonnegative().optional(),
    /** Aluguel máximo (≥ 0). Mesmo formato do preço. */
    aluguel_max: z.number().nonnegative().optional(),
    /** 1 .. tetoDeItens. */
    limite: z
      .number()
      .int()
      .min(1)
      .max(TETO_ITENS_ACF_IMOVEIS)
      .optional()
      .default(TETO_ITENS_ACF_IMOVEIS),
  })
  .strict();

type BuscaAcfImoveis = z.output<typeof PARAMETROS_DA_BUSCA_ACF_IMOVEIS>;

/** Os fixos como a receita os lê (o que chegou da tela, já validado pelo Zod). */
interface FixosDaReceita {
  prefixo?: string;
  post_type?: string;
  campos?: CamposDaReceita;
  taxonomias?: TaxonomiasMapeadas;
  situacao?: SituacaoDaReceita;
}

/** A ordem das colunas da saída — a mesma que a tela e o agente leem. */
const ORDEM_DA_SAIDA: readonly DadoDoImoveis[] = [
  "codigo",
  "tipo",
  "finalidade",
  "bairro",
  "cidade",
  "preco",
  "aluguel",
  "condominio",
  "quartos",
  "suites",
  "banheiros",
  "vagas",
  "area",
];

export const RECEITA_ACF_IMOVEIS: DefinicaoDeReceita = {
  id: "acf-imoveis",
  familia: "acf-imoveis",
  motores: ["mysql"],
  rotulo: "Imóveis do WordPress (ACF ou JetEngine)",
  descricao:
    "Lê os imóveis publicados de um site WordPress (ACF, ou JetEngine no modo padrão de tipo de post): " +
    "título, código, preço, aluguel, condomínio, quartos, suítes, banheiros, vagas, área e link. " +
    "O administrador diz o tipo de post e de onde vem cada dado: um campo do site ou uma categoria. " +
    "Filtros: bairro, cidade, tipo, finalidade (venda ou aluguel), quartos, vagas, preço máximo e aluguel máximo. " +
    "Um filtro só prende quando o dado correspondente está mapeado pelo administrador. " +
    "Imóvel só de aluguel aparece; imóvel vendido ou alugado pode ser escondido. Sem foto nesta fatia.",
  parametrosFixos: PARAMETROS_FIXOS_ACF_IMOVEIS,
  parametrosDaBusca: PARAMETROS_DA_BUSCA_ACF_IMOVEIS,
  tabelas: (fixos) => {
    const f = (fixos ?? {}) as FixosDaReceita;
    const p = f.prefixo ?? PREFIXO_PADRAO;
    const base = [`${p}posts`, `${p}postmeta`];
    // As tabelas de categoria só entram quando HÁ categoria mapeada: quem não
    // usa categoria não precisa liberá-las na conexão.
    if (temCategoriaMapeada(f.taxonomias)) {
      base.push(...tabelasDaTaxonomia(p));
    }
    return base;
  },
  colunas: (fixos) => {
    const f = (fixos ?? {}) as FixosDaReceita;
    const p = f.prefixo ?? PREFIXO_PADRAO;
    const base: Record<string, string[]> = {
      [`${p}posts`]: ["ID", "post_title", "post_status", "post_type", "guid"],
      [`${p}postmeta`]: ["post_id", "meta_key", "meta_value"],
    };
    if (temCategoriaMapeada(f.taxonomias)) {
      Object.assign(base, colunasDaTaxonomia(p));
    }
    return base;
  },
  montar: (fixos, busca, limite) => {
    const f = (fixos ?? {}) as FixosDaReceita;
    const p = f.prefixo ?? PREFIXO_PADRAO;
    const postType = f.post_type ?? POST_TYPE_PADRAO;
    const campos: CamposDaReceita = f.campos ?? {};
    const taxonomias: TaxonomiasMapeadas = f.taxonomias ?? {};
    const situacao = f.situacao;

    const posts = quotarIdentificadorMysql(`${p}posts`);
    const postmeta = quotarIdentificadorMysql(`${p}postmeta`);

    const valores: unknown[] = [];
    const marcador = (v: unknown): string => {
      valores.push(v === undefined ? null : v);
      return `?`;
    };

    const ctx: ContextoDeTaxonomia = { prefixo: p, objeto: "p.ID", marcador };

    /** O apelido da junção de um campo (só existe se o campo foi mapeado). */
    const aliasDe = (dado: DadoDoImoveis): string | undefined =>
      campos[dado] ? `m${dado}` : undefined;

    /** A categoria mapeada de um dado (só existe se o slug não está vazio). */
    const categoriaDe = (dado: DadoDeCategoria) => categoriaMapeada(taxonomias, dado);

    // ─── 1. A SAÍDA ──────────────────────────────────────────────────────────
    // O SELECT vem PRIMEIRO no texto, então os `?` das categorias saem
    // primeiro na lista de valores. A ordem das colunas é fixa.
    const colunas: string[] = ["p.ID as id"];
    const aliasCodigo = aliasDe("codigo");
    if (aliasCodigo) colunas.push(`${aliasCodigo}.meta_value as codigo`);
    colunas.push("p.post_title as titulo");

    for (const dado of ["tipo", "finalidade", "bairro", "cidade"] as const) {
      const categoria = categoriaDe(dado);
      const alias = aliasDe(dado);
      if (categoria) {
        colunas.push(`${subqueryDeTermos(ctx, categoria.taxonomia, categoria.nivel)} as ${dado}`);
      } else if (alias) {
        colunas.push(`${alias}.meta_value as ${dado}`);
      }
    }

    const aliasPreco = aliasDe("preco");
    if (aliasPreco) colunas.push(`${precoNumero(`${aliasPreco}.meta_value`)} as preco`);
    const aliasAluguel = aliasDe("aluguel");
    if (aliasAluguel) colunas.push(`${precoNumero(`${aliasAluguel}.meta_value`)} as aluguel`);
    const aliasCondominio = aliasDe("condominio");
    if (aliasCondominio) colunas.push(`${aliasCondominio}.meta_value as condominio`);
    const aliasQuartos = aliasDe("quartos");
    if (aliasQuartos) colunas.push(`${aliasQuartos}.meta_value as quartos`);
    const aliasSuites = aliasDe("suites");
    if (aliasSuites) colunas.push(`${aliasSuites}.meta_value as suites`);
    const aliasBanheiros = aliasDe("banheiros");
    if (aliasBanheiros) colunas.push(`${aliasBanheiros}.meta_value as banheiros`);
    const aliasVagas = aliasDe("vagas");
    if (aliasVagas) colunas.push(`${aliasVagas}.meta_value as vagas`);
    const aliasArea = aliasDe("area");
    if (aliasArea) colunas.push(`${aliasArea}.meta_value as area`);
    colunas.push("p.guid as link");

    // ─── 2. AS JUNÇÕES ───────────────────────────────────────────────────────
    // Uma LEFT JOIN por campo mapeado. Nenhuma é obrigatória: o LEFT JOIN traz
    // o imóvel mesmo sem o campo (com o valor vazio), que é o caso do imóvel
    // só de aluguel — ele não tem preço de venda e NÃO pode sumir da lista.
    const juncoes: string[] = [];
    for (const dado of ORDEM_DA_SAIDA) {
      const metaKey = campos[dado];
      if (!metaKey) continue;
      const alias = `m${dado}`;
      juncoes.push(
        `left join ${postmeta} ${alias} on ${alias}.post_id = p.ID and ${alias}.meta_key = ${marcador(metaKey)}`,
      );
    }

    // ─── 3. ONDE ─────────────────────────────────────────────────────────────
    const clausulas: string[] = [
      `p.post_type = ${marcador(postType)}`,
      `p.post_status = ${marcador("publish")}`,
    ];

    const b = busca as BuscaAcfImoveis;

    /**
     * O filtro de um dado que pode ser campo OU categoria.
     *
     * Quando o dado é CATEGORIA, o filtro é um `exists` sobre as três tabelas
     * de termos (e não um LIKE em meta) — o bairro do imóvel é o TERMO.
     * Quando o dado é CAMPO, é o LIKE de sempre.
     * Quando o dado não foi mapeado, o filtro NÃO se aplica: a busca devolve
     * o que tem, e a receita avisa isso na descrição.
     */
    const filtroDoDado = (dado: DadoDeCategoria, valor: string | undefined): string | null => {
      if (!valor) return null;
      const alvo = alvoDeLike(valor);
      const categoria = categoriaDe(dado);
      if (categoria) {
        return clausulaDeTermo(ctx, categoria.taxonomia, categoria.nivel, alvo, dado === "finalidade");
      }
      const alias = aliasDe(dado);
      if (!alias) return null;
      return `lower(${alias}.meta_value) like ${marcador(alvo)} escape '!'`;
    };

    const filtroBairro = filtroDoDado("bairro", b.bairro);
    if (filtroBairro) clausulas.push(filtroBairro);

    const filtroCidade = filtroDoDado("cidade", b.cidade);
    if (filtroCidade) clausulas.push(filtroCidade);

    const filtroTipo = filtroDoDado("tipo", b.tipo);
    if (filtroTipo) clausulas.push(filtroTipo);

    const filtroFinalidade = filtroDoDado("finalidade", b.finalidade);
    if (filtroFinalidade) clausulas.push(filtroFinalidade);

    // Quartos e vagas: o meta_value é texto; o CAST compara como número.
    if (b.quartos_min !== undefined) {
      const alias = aliasDe("quartos");
      if (alias) {
        clausulas.push(`CAST(${alias}.meta_value AS DECIMAL(10,2)) >= ${marcador(b.quartos_min)}`);
      }
    }
    if (b.vagas_min !== undefined) {
      const alias = aliasDe("vagas");
      if (alias) {
        clausulas.push(`CAST(${alias}.meta_value AS DECIMAL(10,2)) >= ${marcador(b.vagas_min)}`);
      }
    }

    // Preço máximo: conversão robusta de "650.000,00" / "650,000.00" / "480000".
    if (b.preco_max !== undefined) {
      const alias = aliasDe("preco");
      if (alias) {
        clausulas.push(`(${precoNumero(`${alias}.meta_value`)}) <= ${marcador(b.preco_max)}`);
      }
    }
    if (b.aluguel_max !== undefined) {
      const alias = aliasDe("aluguel");
      if (alias) {
        clausulas.push(`(${precoNumero(`${alias}.meta_value`)}) <= ${marcador(b.aluguel_max)}`);
      }
    }

    // Situação: imóvel vendido (ou alugado) não é oferecido.
    const campoSituacao = situacao?.campo?.trim() ?? "";
    const valoresOcultos = (situacao?.ocultar ?? [])
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0)
      .slice(0, 10);
    if (campoSituacao.length > 0 && valoresOcultos.length > 0) {
      // A ORDEM dos `?`: o campo vem antes da lista de valores no texto.
      const marcaCampo = marcador(campoSituacao);
      const marcas = valoresOcultos.map((v) => marcador(v)).join(", ");
      clausulas.push(
        `not exists (select 1 from ${postmeta} msituacao where msituacao.post_id = p.ID ` +
          `and msituacao.meta_key = ${marcaCampo} and lower(msituacao.meta_value) in (${marcas}))`,
      );
    }

    // ─── 4. O SQL ────────────────────────────────────────────────────────────
    const sql =
      `select ${colunas.join(", ")} ` +
      `from ${posts} p ` +
      `${juncoes.join(" ")} ` +
      `where ${clausulas.join(" and ")} ` +
      `order by p.ID ` +
      `limit ${marcador(limite ?? TETO_ITENS_ACF_IMOVEIS)}`;

    return { sql, valores };
  },
  tetoDeItens: TETO_ITENS_ACF_IMOVEIS,
};
