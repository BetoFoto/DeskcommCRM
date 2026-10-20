/**
 * O resumo da equipe LIDO DO MUNDO, no momento do disparo (#2642).
 *
 * ─── Por que este arquivo existe, separado do texto ────────────────────────
 *
 * `resumo-para-a-equipe.ts` é a função PURA que monta o texto; este módulo é
 * quem LÊ o banco (pontuação, passagem, idioma) e entrega os fatos para ela.
 * A separação é a mesma de `texto-do-aviso` × `aviso-ao-suporte`: o texto é
 * testável sem rede, e a leitura é testável com o dublê de PostgREST.
 *
 * ─── Por que as DUAS ações usam o MESMO carregador ─────────────────────────
 *
 * O recorte do mantenedor no PR #2834 deixou uma coisa só em cada lugar: o
 * WhatsApp da equipe (`notify_team`, sem destinatário escolhido) e o e-mail
 * (`send_email`, com o destinatário "membro da equipe" e a variável
 * `{{resumo}}`). Se cada ação montasse o resumo por conta própria, a mesma
 * frase teria duas réguas de limpeza e dois jeitos de ler a pontuação — que é
 * exatamente o defeito que o recorte veio matar.
 *
 * ─── O resumo é LIDO AGORA, nunca gravado ─────────────────────────────────
 *
 * Nada de texto fixo na regra: `lead`, `contact`, a pontuação (número E motivo,
 * do jeito que `crm_lead_scores` grava) e a passagem no checkpoint mais novo
 * são lidos no disparo. A régua de limpeza do que o MODELO escreveu mora em
 * `montarResumoParaAEquipe`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { IDIOMAS, type Idioma } from "@/lib/i18n/idiomas";

import {
  montarResumoParaAEquipe,
  type ContatoDoResumo,
  type LeadDoResumo,
  type PassagemDoResumo,
  type PontuacaoDoResumo,
} from "./resumo-para-a-equipe";

type Admin = SupabaseClient;

/**
 * Contexto de um evento: o motor monta `lead` e `contact` (`buildContext`),
 * mas o tipo é `Record<string, unknown>` — então quem lê tem de estreitar com
 * as MESMAS colunas que o banco devolve. Nomes que batem com
 * `database.types.ts`, e não com o que parece bom.
 */
export function leadDoContexto(bruto: unknown): (LeadDoResumo & { id: string; contact_id: string | null }) | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const l = bruto as Record<string, unknown>;
  if (typeof l.id !== "string" || l.id === "") return null;
  return {
    id: l.id,
    contact_id: typeof l.contact_id === "string" && l.contact_id !== "" ? l.contact_id : null,
    title: typeof l.title === "string" ? l.title : null,
    description: typeof l.description === "string" ? l.description : null,
    status: typeof l.status === "string" ? l.status : null,
    value_cents: typeof l.value_cents === "number" ? l.value_cents : null,
    currency: typeof l.currency === "string" ? l.currency : null,
    won_reason: typeof l.won_reason === "string" ? l.won_reason : null,
  };
}

export function contatoDoContexto(bruto: unknown): ContatoDoResumo | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const c = bruto as Record<string, unknown>;
  return {
    name: typeof c.name === "string" ? c.name : null,
    display_name: typeof c.display_name === "string" ? c.display_name : null,
    phone_number: typeof c.phone_number === "string" ? c.phone_number : null,
  };
}

/** `organizations.locale` pode trazer o que for; o catálogo decide o que é idioma. */
async function idiomaDaOrganizacao(admin: Admin, organizationId: string): Promise<Idioma> {
  const { data } = await admin.from("organizations").select("locale").eq("id", organizationId).maybeSingle();
  const bruto = (data as { locale?: string | null } | null)?.locale;
  return typeof bruto === "string" && (IDIOMAS as readonly string[]).includes(bruto)
    ? (bruto as Idioma)
    : "pt-BR";
}

/**
 * `crm_lead_scores` — número E motivo na mesma linha.
 *
 * Os dois vêm juntos porque a própria constraint do banco não deixa número sem
 * frase ("score sem razão não é gravado"). A coluna é `integer`, de 0 a 100.
 */
async function pontuacaoDoLead(
  admin: Admin,
  organizationId: string,
  leadId: string,
): Promise<PontuacaoDoResumo | null> {
  const { data } = await admin
    .from("crm_lead_scores")
    .select("ai_probability, ai_probability_reason")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (data === null) return null;
  const linha = data as { ai_probability?: number | null; ai_probability_reason?: string | null };
  return {
    probabilidade: typeof linha.ai_probability === "number" ? linha.ai_probability : null,
    motivo: typeof linha.ai_probability_reason === "string" ? linha.ai_probability_reason : null,
  };
}

/** O checkpoint mais novo do contato: o que a conversa COMBINOU com o cliente. */
async function passagemDoContato(
  admin: Admin,
  organizationId: string,
  contactId: string,
): Promise<PassagemDoResumo | null> {
  const { data } = await admin
    .from("lead_checkpoints")
    .select("commitments, objections, next_action")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data === null) return null;
  const linha = data as {
    commitments?: string[] | null;
    objections?: string[] | null;
    next_action?: string | null;
  };
  return {
    compromissos: Array.isArray(linha.commitments) ? linha.commitments : [],
    objecoes: Array.isArray(linha.objections) ? linha.objections : [],
    proximaAcao: typeof linha.next_action === "string" ? linha.next_action : null,
  };
}

/**
 * O resumo pronto, ou `null` quando o evento não traz negócio.
 *
 * `null` e não string vazia porque as duas coisas querem dizer coisas
 * diferentes na tela: sem lead é "este evento não tem negócio", e resumo vazio
 * seria "o negócio não tem nada a dizer" — quem opera conserta um cadastro, não
 * o outro.
 */
export async function carregarResumoParaAEquipe(entrada: {
  admin: Admin;
  organizationId: string;
  /** `rule.name` — o nome que o operador deu à regra que disparou. */
  regra: string;
  /** O contexto cru do evento (`ctx.context`). */
  contexto: Record<string, unknown>;
}): Promise<string | null> {
  const { admin, organizationId, contexto } = entrada;
  const lead = leadDoContexto(contexto.lead);
  if (lead === null) return null;

  return montarResumoParaAEquipe({
    idioma: await idiomaDaOrganizacao(admin, organizationId),
    regra: entrada.regra,
    lead,
    contato: contatoDoContexto(contexto.contact),
    pontuacao: await pontuacaoDoLead(admin, organizationId, lead.id),
    passagem:
      lead.contact_id !== null
        ? await passagemDoContato(admin, organizationId, lead.contact_id)
        : null,
  });
}
