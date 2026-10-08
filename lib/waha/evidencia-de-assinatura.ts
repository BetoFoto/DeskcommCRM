/**
 * O WAHA está assinando as entregas desta instalação? — a resposta medida, para
 * quem decide ligar "Exigir assinatura" em /admin/sistema.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O interruptor existe desde a #1034, mas quem o olhava não tinha como saber se
 * ligá-lo era seguro: ligado sem o WAHA assinar, toda mensagem recebida vira 401
 * e some (a rota recusa antes de arquivar). Desligado, uma entrega forjada com o
 * token da URL entra no CRM. A única forma de decidir era abrir o banco.
 *
 * O arquivo de webhooks já guarda a verdade: cada entrega aceita grava
 * `valid_signature` (true só quando a assinatura conferiu — ver
 * `lib/waha/webhook-auth.ts`). Aqui só se CONTA isso numa janela recente.
 *
 * ── O que isto NÃO faz ──────────────────────────────────────────────────────
 *
 * Não liga nada sozinho. Uma trava automática ("assinou uma vez, exige para
 * sempre") cortaria a entrada de mensagens no dia em que alguém trocasse o
 * segredo ou a imagem do WAHA — e quem perde a mensagem é o cliente da empresa,
 * sem aviso. A decisão continua com a pessoa; ela só passa a decidir com dado.
 *
 * Nunca lança. Leitura que falha vira `null` e a tela simplesmente não mostra a
 * linha — nunca "não assina", que levaria alguém a deixar desligado à toa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export const DIAS_DA_JANELA = 7;

export type VereditoDaAssinatura = "sem_trafego" | "todas_assinadas" | "nenhuma_assinada" | "misto";

export interface EvidenciaDeAssinatura {
  assinadas: number;
  semAssinatura: number;
  dias: number;
  veredito: VereditoDaAssinatura;
}

export function resumirEvidencia(assinadas: number, semAssinatura: number, dias = DIAS_DA_JANELA): EvidenciaDeAssinatura {
  const total = assinadas + semAssinatura;
  const veredito: VereditoDaAssinatura =
    total === 0
      ? "sem_trafego"
      : semAssinatura === 0
        ? "todas_assinadas"
        : assinadas === 0
          ? "nenhuma_assinada"
          : "misto";
  return { assinadas, semAssinatura, dias, veredito };
}

export async function carregarEvidenciaDeAssinatura(
  admin: SupabaseClient,
  agora: Date = new Date(),
): Promise<EvidenciaDeAssinatura | null> {
  const desde = new Date(agora.getTime() - DIAS_DA_JANELA * 24 * 60 * 60 * 1000).toISOString();
  const contar = (assinada: boolean) =>
    admin
      .from("webhook_events_log")
      .select("id", { count: "exact", head: true })
      .eq("provider", "waha")
      .eq("valid_signature", assinada)
      .gte("received_at", desde);
  try {
    const [sim, nao] = await Promise.all([contar(true), contar(false)]);
    if (sim.error || nao.error || sim.count == null || nao.count == null) {
      logger.warn("[waha.evidencia] contagem das entregas indisponível", {
        error: sim.error?.message ?? nao.error?.message ?? "count ausente",
      });
      return null;
    }
    return resumirEvidencia(sim.count, nao.count);
  } catch (err) {
    logger.warn("[waha.evidencia] contagem das entregas falhou", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
