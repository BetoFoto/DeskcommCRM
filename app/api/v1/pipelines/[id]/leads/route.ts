/**
 * GET /api/v1/pipelines/[id]/leads?page=&per_page=
 *
 * A página da LISTA do funil (#3172, fatia 1): uma fatia dos negócios do funil,
 * lida do banco com `range`, mais o `meta` que diz de quantos ela é.
 *
 * ─── Por que uma rota nova, e não a do quadro ───────────────────────────────
 *
 * `GET /api/v1/pipelines/[id]/board` lê o funil INTEIRO de propósito: o quadro
 * precisa de todas as colunas montadas de uma vez, e é ele que alimenta o pulso
 * de realtime e o filtro em memória da barra. Enfiar paginação lá dentro
 * mudaria o contrato de quem já depende dele (o Kanban, o diálogo de negócio
 * duplicado, o seletor de motivos de perda) sem que nenhum desses precisasse
 * disso. Esta rota nasce AO LADO, com o custo da página em vez do funil: um
 * funil migrado com milhares de negócios abre a lista numa consulta que o
 * PostgREST corta em `per_page` linhas ANTES de a RLS avaliar o resto.
 *
 * ─── O que esta fatia NÃO faz ──────────────────────────────────────────────
 *
 * Filtros combináveis e ordenação por cabeçalho (fatia 2), escolha de colunas,
 * seleção em lote e visões salvas (fatia 3). A ordem é a do quadro
 * (`position_in_stage`), a mesma que o operador já vê nas colunas — ordenar por
 * outra coluna sem a tela que a pede seria contrato sem chamador.
 *
 * ─── Isolamento ────────────────────────────────────────────────────────────
 *
 * `organization_id` sai do cookie de sessão validado (`requireRole`), nunca do
 * corpo nem da URL, e é filtrado explicitamente além da RLS. O funil é
 * conferido antes: id de outro tenant devolve 404, não uma lista vazia — "não
 * existe" e "não tem negócio" são respostas diferentes, e a segunda mente.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types/leads";

export const dynamic = "force-dynamic";

/** O tamanho de página que a tela pede por padrão (issue #3172: 50/100/200). */
export const LEADS_POR_PAGINA = 50;

/** O teto do que a URL pode pedir. Acima disso a página é honesta, não gigante. */
export const LEADS_POR_PAGINA_MAX = 200;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * A página pedida, inteiro ≥ 1 escrito só com dígitos. Ausente ou inválida
 * (`0`, `-3`, `abc`, `2x`) vale 1: responder `meta.page: 3` para uma URL que
 * pediu outra coisa seria a resposta mentir sobre a pergunta.
 */
function paginaPedida(bruto: string | null): number {
  if (bruto === null || !/^\d+$/.test(bruto.trim())) return 1;
  const n = Number(bruto.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/**
 * O tamanho da página, entre 1 e `LEADS_POR_PAGINA_MAX`. Inválido ou ausente cai
 * no padrão; acima do teto é o teto, e não um 422 — a tela que pediu 500 quer
 * "o máximo que der", e recusar a lista inteira por causa disso é pior.
 */
function porPaginaPedido(bruto: string | null): number {
  if (bruto === null || !/^\d+$/.test(bruto.trim())) return LEADS_POR_PAGINA;
  const n = Number(bruto.trim());
  if (!Number.isSafeInteger(n) || n < 1) return LEADS_POR_PAGINA;
  return Math.min(n, LEADS_POR_PAGINA_MAX);
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: pipelineId } = await ctx.params;

  // `viewer` é o piso: ler a lista do funil é a mesma permissão de abrir o
  // quadro. A ESCRITA continua onde sempre esteve, nas rotas de lead.
  const authz = await requireRole("viewer", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const params = req.nextUrl.searchParams;
  const pagina = paginaPedida(params.get("page"));
  const porPagina = porPaginaPedido(params.get("per_page"));
  const de = (pagina - 1) * porPagina;

  const supabase = await createClient();

  const { data: funil, error: funilErr } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (funilErr) {
    return fail("internal_error", funilErr.message, 500, { requestId });
  }
  if (!funil) {
    return fail("resource_not_found", t("Funil não encontrado."), 404, { requestId });
  }

  // A MESMA régua nas duas consultas (contagem e página), e ela exclui
  // arquivados como o quadro: a lista do funil não é o arquivo morto, e uma
  // contagem que contasse o arquivado faria `has_more` prometer página que a
  // consulta de dados não devolve.
  const { count, error: countErr } = await supabase
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", orgId)
    .neq("status", "archived");
  if (countErr) {
    return fail("internal_error", countErr.message, 500, { requestId });
  }
  const total = count ?? 0;

  // ⚠️ O `range` É O CONSERTO. Sem ele esta consulta lê o funil inteiro (o
  // corte de 1.000 linhas do PostgREST vem DEPOIS de o banco filtrar e ordenar
  // tudo, e cada linha passa por `fn_can_view_lead`), que é exatamente o
  // problema que a issue mede — 19 s num funil migrado, até estourar o
  // `statement_timeout` do papel `authenticated`.
  const { data, error } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", orgId)
    .neq("status", "archived")
    .order("position_in_stage")
    .range(de, de + porPagina - 1);
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok((data ?? []) as Lead[], {
    requestId,
    meta: {
      page: pagina,
      per_page: porPagina,
      total,
      // Pela contagem, não pelo tamanho da página: uma página cheia na ÚLTIMA
      // fatia (`total` = 50, `per_page` = 50) não tem próxima, e dizer que tem
      // mandaria a tela buscar uma página que volta vazia.
      has_more: de + porPagina < total,
    },
  });
}
