/**
 * A MÁQUINA DA ASSINATURA, PURA (spec cobrança do revendedor §3.2).
 *
 * `traduzirSituacao` diz em que estado a assinatura está a partir do que o
 * provedor respondeu na RELEITURA — nunca do corpo do webhook. `aplicarLeitura`
 * diz o que essa leitura muda na linha, com as regras de gravação:
 *   - a dívida é monotônica: `vencidaDesde` só recua, e só zera ao voltar a
 *     ativa/trial (cancelar e reassinar não reinicia o relógio);
 *   - o período pago nunca é apagado por leitura nula;
 *   - transição PARA ativa/trial zera o aviso da régua;
 *   - o plano agendado vira só quando um período novo foi PAGO.
 * Sem banco e sem relógio: `lidoEm` é injetado. Quem grava é `sincronizar`.
 */
import type { Situacao } from "@/lib/cobranca/provedores/contrato";
import type { ErroDeLeitura, EstadoDaAssinatura } from "@/lib/cobranca/vocabulario";

export function traduzirSituacao(s: Situacao, trialAte: Date | null, agora: Date): EstadoDaAssinatura {
  if (s.cancelada && !s.cancelaNoFim) return "cancelada";
  if (s.existe) return s.emAtraso ? "em_atraso" : "ativa";
  if (s.jaPagou) return "cancelada";
  if (s.emTesteNoProvedorAte !== null && s.emTesteNoProvedorAte > agora) return "trial";
  // ponytail: sem data de teste conta como teste vencido (falha fechada); a régua avisa antes de suspender.
  return trialAte !== null && trialAte > agora ? "trial" : "em_atraso";
}

/** O que `sincronizar` lê da linha antes de aplicar a leitura. */
export interface AssinaturaAtual {
  readonly estado: EstadoDaAssinatura;
  readonly planoId: string;
  readonly planoAgendadoId: string | null;
  readonly trialAte: Date | null;
  readonly vencidaDesde: Date | null;
  readonly proximoVencimento: Date | null;
  readonly provedorAssinaturaId: string | null;
}

/** O que `sincronizar` grava. Cada campo é uma coluna de `cobranca_assinaturas`. */
export interface LeituraAplicada {
  readonly estado: EstadoDaAssinatura;
  readonly mudouEstado: boolean;
  readonly vencidaDesde: Date | null;
  readonly proximoVencimento: Date | null;
  readonly cancelaNoFim: boolean;
  readonly planoId: string;
  readonly planoAgendadoId: string | null;
  readonly planoAplicado: boolean;
  readonly provedorAssinaturaId: string | null;
  readonly assinaturasVivas: number;
  readonly relidaEm: Date;
  readonly ultimoErro: ErroDeLeitura | null;
  /** true → `ultimo_aviso = null, ultimo_aviso_em = null`. */
  readonly zerarAviso: boolean;
  /** true → `checkout_url = null, checkout_expira_em = null`. */
  readonly limparCheckout: boolean;
}

function menor(a: Date, b: Date): Date {
  return a <= b ? a : b;
}

export function aplicarLeitura(atual: AssinaturaAtual, s: Situacao, lidoEm: Date): LeituraAplicada {
  const estado = traduzirSituacao(s, atual.trialAte, lidoEm);
  const emDia = estado === "ativa" || estado === "trial";

  let vencidaDesde = emDia ? null : atual.vencidaDesde;
  if (estado === "em_atraso") {
    const doTesteVencido = !s.existe && !s.jaPagou;
    const x = (doTesteVencido ? atual.trialAte : s.vencidaDesde) ?? lidoEm;
    vencidaDesde = menor(atual.vencidaDesde ?? x, x);
  }

  // Período novo pago: o fim do período avançou com a assinatura em dia, OU o
  // atraso acabou de ser pago — a Stripe abre o período novo ANTES de cobrar
  // (past_due já traz o current_period_end novo), então pagar o atraso é pagar
  // o período em que o plano agendado deveria valer.
  const periodoNovoPago =
    estado === "ativa" &&
    s.proximoVencimento !== null &&
    (atual.proximoVencimento === null || s.proximoVencimento > atual.proximoVencimento || atual.estado === "em_atraso");
  // Cancelada → ativa é assinatura NOVA, cobrada pelo plano do checkout: o agendado
  // pertencia à assinatura antiga (trocarPlano mexeu no preço dela), então é descartado.
  const reassinou = atual.estado === "cancelada" && estado === "ativa";
  const agendado = periodoNovoPago && !reassinou ? atual.planoAgendadoId : null;

  return {
    estado,
    mudouEstado: estado !== atual.estado,
    vencidaDesde,
    proximoVencimento: s.proximoVencimento ?? atual.proximoVencimento,
    cancelaNoFim: s.cancelaNoFim,
    planoId: agendado ?? atual.planoId,
    planoAgendadoId: agendado || reassinou ? null : atual.planoAgendadoId,
    planoAplicado: agendado !== null,
    provedorAssinaturaId: s.assinaturaRef ?? atual.provedorAssinaturaId,
    assinaturasVivas: s.assinaturasVivas,
    relidaEm: lidoEm,
    ultimoErro: s.pagamentoSemAssinaturaViva ? "pagamento_de_assinatura_cancelada" : null,
    zerarAviso: emDia && estado !== atual.estado,
    limparCheckout: s.assinaturasVivas > 0,
  };
}
