import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveOwnerPatch } from "@/lib/leads/owner-patch";
import { logger } from "@/lib/logger";

/**
 * O NEGÓCIO ABERTO ACOMPANHA O RESPONSÁVEL DA CONVERSA (#3177).
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * Conversa e negócio são dois donos na mesma casa: `conversations.
 * assigned_to_user_id` (o Inbox) e `crm_leads.owner_user_id` (o funil — migration
 * 0036 diz isso com todas as letras). Transferir a conversa mexia só no
 * primeiro. O card continuava com o responsável antigo (ou sem nenhum), então
 * quem recebeu o atendimento não achava o negócio no filtro "Responsável" e as
 * metas por vendedor contavam para quem já tinha saído da conversa.
 *
 * ─── A régua ────────────────────────────────────────────────────────────────
 *
 * 1. Só o negócio ABERTO (`status = 'open'`): encerrado/congelado é histórico,
 *    e ganho ou perdido é desfecho de quem trabalhou — não de quem passa a
 *    atender a conversa (a MESMA régua da duplicidade, `negocio-aberto-duplicado`).
 * 2. UM negócio aberto: leva. MAIS DE UM: não mexe em nenhum e devolve
 *    `varios_negocios_abertos`. Escolher sozinho entre dois negócios do mesmo
 *    contato é adivinhação — a pergunta "quais levar?" (sugestão 2 da issue) só
 *    pode ser respondida por gente, e transferir a conversa é um clique.
 * 3. ZERO negócio aberto: nada é criado. O Inbox não inventa negócio; quem
 *    abre card é quem vende.
 * 4. Já é o responsável: não escreve. Sem esta saída, uma transferência para o
 *    dono atual do card regravaria a linha e emitiria um `lead.assigned` que
 *    não aconteceu — o trigger do banco só olha o UPDATE.
 *
 * ─── Quem autoriza ──────────────────────────────────────────────────────────
 *
 * O cliente é o da SESSÃO (RLS ligada), nunca o service-role. Quem transfere a
 * conversa pode não poder editar o negócio: a `crm_leads_update` (migration
 * 0036, revista na 0529) exige, para `agent`, que o dono NOVO esteja no escopo
 * de visibilidade dele — em `own`/`own_and_unassigned` um agente não atribui o
 * card a um colega (#2556). É a régua certa e ela permanece: a rota que
 * transfere a conversa não ganha, por aqui, nenhuma permissão que a rota de
 * negócios já não dê. Quando o banco recusa, a transferência continua de pé (o
 * fato da conversa já está gravado) e a leitura diz o porquê em `motivo`.
 *
 * ─── Por que NUNCA derruba quem chamou ──────────────────────────────────────
 *
 * A transferência é o pedido; esta sincronia é o efeito colateral. Um erro de
 * leitura/escrita aqui não pode virar 500 numa transferência que já aconteceu —
 * a mesma doutrina de `negocioAbertoExistente` (um aviso não impede um negócio
 * legítimo de nascer) e do `claim` engolido em `/messages`.
 */

/** Por que a sincronia parou onde parou. Literal: é contrato do log e do teste. */
export type MotivoDaSincronia =
  | "sincronizado"
  | "ja_era_o_responsavel"
  | "sem_negocio_aberto"
  | "varios_negocios_abertos"
  | "recusado_pelo_banco"
  | "falha";

export interface ResultadoDaSincronia {
  /** `true` só quando ESTA chamada gravou o novo responsável no card. */
  gravou: boolean;
  motivo: MotivoDaSincronia;
  /** Quantos negócios abertos o chamador enxerga neste contato (0, 1 ou 2+). */
  abertos: number;
  /** O negócio alvo, quando houve exatamente um. */
  leadId?: string;
}

export interface AlvoDaSincronia {
  organizationId: string;
  /** O contato DA CONVERSA. Nulo (conversa órfã) não tem negócio a procurar. */
  contactId: string | null | undefined;
  /** Para quem a conversa passou — o mesmo id que foi para a conversa. */
  toUserId: string;
}

/** O mínimo que a régua lê da linha. */
interface NegocioAberto {
  id: string;
  owner_user_id: string | null;
}

export async function sincronizarNegocioAbertoDoContato(
  supabase: SupabaseClient,
  alvo: AlvoDaSincronia,
): Promise<ResultadoDaSincronia> {
  const { organizationId, contactId, toUserId } = alvo;
  if (!contactId) {
    return { gravou: false, motivo: "sem_negocio_aberto", abertos: 0 };
  }

  try {
    // Sem `limit`: a régua precisa do NÚMERO (0, 1, 2+), não de "existe algum".
    // Um contato tem punhado de negócios; o teto artificial seria uma segunda
    // regra escondida dentro da primeira.
    const { data, error } = await supabase
      .from("crm_leads")
      .select("id, owner_user_id")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .eq("status", "open");

    if (error) {
      logger.warn("[inbox.negocio-aberto] leitura dos negócios abertos falhou", {
        motivo: error.message,
        organizationId,
      });
      return { gravou: false, motivo: "falha", abertos: 0 };
    }

    const abertos = (data ?? []) as unknown as NegocioAberto[];

    if (abertos.length === 0) {
      return { gravou: false, motivo: "sem_negocio_aberto", abertos: 0 };
    }
    if (abertos.length > 1) {
      logger.info("[inbox.negocio-aberto] mais de um negócio aberto: nenhum foi tocado", {
        organizationId,
        contactId,
        abertos: abertos.length,
      });
      return { gravou: false, motivo: "varios_negocios_abertos", abertos: abertos.length };
    }

    const negocio = abertos[0];
    // Inalcançável (a contagem acima já garantiu exatamente um), mas o índice de
    // um array é opcional para o compilador — e a saída é a mesma de "nenhum".
    if (!negocio) {
      return { gravou: false, motivo: "sem_negocio_aberto", abertos: 0 };
    }
    if (negocio.owner_user_id === toUserId) {
      return {
        gravou: false,
        motivo: "ja_era_o_responsavel",
        abertos: 1,
        leadId: negocio.id,
      };
    }

    // O trio dono/kind vem do helper único (0070) — escrever `owner_user_id` na
    // mão é como nasce o card "com dono e sem kind", que some do filtro e das
    // métricas sem erro nenhum.
    const dono = resolveOwnerPatch({ owner_user_id: toUserId });
    if (!dono.ok || !dono.patch) {
      return { gravou: false, motivo: "falha", abertos: 1, leadId: negocio.id };
    }

    // `status = 'open'` TAMBÉM na escrita: entre ler e gravar há uma janela, e
    // o card pode ter sido ganho/perdido nela. Defesa que depende só da leitura
    // anterior some quando alguém reordena o código (mesma lição do _handler).
    const { data: gravado, error: erroDeEscrita } = await supabase
      .from("crm_leads")
      .update({ ...dono.patch, assigned_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", negocio.id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();

    if (erroDeEscrita) {
      logger.warn("[inbox.negocio-aberto] escrita do responsável falhou", {
        motivo: erroDeEscrita.message,
        organizationId,
        leadId: negocio.id,
      });
      return { gravou: false, motivo: "falha", abertos: 1, leadId: negocio.id };
    }

    // Zero linhas com o filtro fechado (org + id + aberto) é a RLS recusando —
    // não existe outro caminho para "não achou" aqui.
    if (!gravado) {
      return { gravou: false, motivo: "recusado_pelo_banco", abertos: 1, leadId: negocio.id };
    }

    return { gravou: true, motivo: "sincronizado", abertos: 1, leadId: negocio.id };
  } catch (erro) {
    logger.error("[inbox.negocio-aberto] sincronia do negócio aberto estourou", {
      motivo: erro instanceof Error ? erro.message : String(erro),
      organizationId,
    });
    return { gravou: false, motivo: "falha", abertos: 0 };
  }
}
