/**
 * A INSCRIÇÃO DORMENTE QUE ACORDA COM A VAGA TOMADA CEDE — NÃO MORRE.
 *
 * ## O defeito, medido numa instalação real (19–20/10/2026)
 *
 * 1. O fluxo A inscreve o contato e chega a uma espera `fixed` com
 *    `immune_to_reply` — a inscrição vai para `dormente`, que por construção NÃO
 *    ocupa a vaga de `idx_followup_enrollments_one_live`.
 * 2. 43 min depois a etapa muda e o fluxo B inscreve o mesmo contato. Correto:
 *    a vaga estava livre.
 * 3. No dia seguinte A acorda; o `advance` grava `status: 'active'`, o índice
 *    recusa (23505), o motor tratava como falha comum, repetia com backoff e
 *    marcava `dead` com o aviso de INCIDENTE "Um fluxo de follow-up parou de
 *    tentar … duplicate key" na Central. O contato estava bem servido por B.
 *
 * ## O que fica preso aqui
 *
 * - a dormente cede: `cancelled`, motivo legível, evento na trilha, sem aviso e
 *   sem gastar tentativa;
 * - a MESMA recusa numa inscrição que já estava viva continua falha (é corrida);
 * - controle: com a vaga livre, a dormente acorda e anda normalmente;
 * - só o 23505 do índice de vaga vira o erro tipado.
 *
 * ## O que NÃO prova
 *
 * Nada com Postgres real: que o `fn_followup_patch` devolve o 23505 com o nome
 * do índice na mensagem foi medido no `last_error` gravado em produção, não aqui.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { DICIONARIO } from "@/lib/i18n/dicionario";
import {
  MOTIVO_DA_VAGA_OCUPADA,
  VagaDoContatoOcupadaError,
  erroDoPatch,
  runFollowupTick,
  type AdminClient,
} from "@/lib/followup/engine";
import { descreveEvento } from "@/lib/followup/eventos-legiveis";
import type { FlowGraph } from "@/lib/followup/graph-schema";
import type { EnrollmentRow } from "@/lib/followup/node-handlers";

const AGORA = new Date("2026-10-20T16:37:00.000Z");
const STATUS_QUE_OCUPAM_VAGA = new Set(["active", "waiting_reply", "paused_handoff", "paused_manual"]);
const RECUSA_DO_INDICE = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "idx_followup_enrollments_one_live"',
};

const GRAFO: FlowGraph = {
  nodes: [
    {
      id: "espera",
      type: "wait",
      label: "Aguardar 1 dia",
      position: { x: 0, y: 0 },
      config: { mode: "fixed", duration_ms: 86_400_000, immune_to_reply: true },
    },
    { id: "fim", type: "end", label: "Fim", position: { x: 0, y: 0 }, config: { outcome: "exhausted" } },
  ],
  edges: [{ id: "espera-fim", source: "espera", target: "fim", priority: 0, condition: { type: "always" } }],
};

function loja(opts: { status: EnrollmentRow["status"]; vagaOcupada: boolean; maxAttempts?: number }) {
  const enrollment: EnrollmentRow = {
    id: "enr-1",
    organization_id: "org",
    pointer_id: "ptr",
    version_id: "v1",
    contact_id: "contato-1",
    conversation_id: null,
    current_node_id: "espera",
    status: opts.status,
    next_eval_at: AGORA.toISOString(),
    claimed_until: null,
    attempts: 0,
    max_attempts: opts.maxAttempts ?? 5,
    last_error: null,
    steps_taken: 3,
    outcome: null,
    cancel_reason: null,
    started_at: AGORA.toISOString(),
    completed_at: null,
    updated_at: AGORA.toISOString(),
  };
  const eventos: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  const avisos = vi.fn(async () => undefined);
  const db: AdminClient = {
    async claimDueEnrollments() {
      return enrollment.next_eval_at !== null && Date.parse(enrollment.next_eval_at) <= AGORA.getTime()
        ? [{ ...enrollment }]
        : [];
    },
    loadFlowGraph: async () => GRAFO,
    loadLeadFacts: async () => ({ lead_stage: null, tags: [] }),
    // A espera já começou no passo anterior: é o que faz o nó `wait` dar a espera por vencida.
    loadEnrollmentEvents: async () => [
      { node_id: "espera", idempotency_key: "espera:2", event_type: "wait_started", payload: {} },
    ],
    loadLastInboundBody: async () => null,
    async insertEnrollmentEvent(e) {
      eventos.push({ event_type: e.event_type, payload: e.payload });
      return { inserted: true };
    },
    async updateEnrollment(_id, _org, patch) {
      // O que o `fn_followup_patch` faz: recusa levar a inscrição a um status que
      // ocupa vaga quando outra inscrição do contato já ocupa a dela.
      if (opts.vagaOcupada && patch.status !== undefined && STATUS_QUE_OCUPAM_VAGA.has(patch.status)) {
        throw erroDoPatch(RECUSA_DO_INDICE);
      }
      Object.assign(enrollment, patch);
    },
    loadFlowPointerName: async () => "Prospecção · abordagem por IA",
    insertDeadInboxItem: avisos,
    persistirRespostaFollowup: async () => undefined,
  };
  const tick = () => runFollowupTick({ db, clock: () => AGORA, enqueueJob: async () => undefined });
  return { enrollment, eventos, avisos, tick };
}

describe("a dormente acorda e encontra outro fluxo no contato", () => {
  it("⭐ cede: encerra com o motivo, registra na trilha, sem aviso na Central e sem gastar tentativa", async () => {
    const l = loja({ status: "dormente", vagaOcupada: true });
    await l.tick();

    expect(l.enrollment.status).toBe("cancelled");
    expect(l.enrollment.cancel_reason).toBe(MOTIVO_DA_VAGA_OCUPADA);
    expect(l.enrollment.next_eval_at).toBeNull();
    expect(l.enrollment.attempts).toBe(0);
    expect(l.avisos).not.toHaveBeenCalled();
    expect(l.eventos.map((e) => e.event_type)).toContain("woke_into_taken_slot");
  });

  it("⭐ com as tentativas no limite, também não vira `dead` (era o desfecho medido)", async () => {
    // `max_attempts: 0` põe a PRIMEIRA falha no `markDead` — o caminho antigo
    // abriria aqui o aviso "Um fluxo de follow-up parou de tentar".
    const l = loja({ status: "dormente", vagaOcupada: true, maxAttempts: 0 });
    await l.tick();
    expect(l.enrollment.status).toBe("cancelled");
    expect(l.avisos).not.toHaveBeenCalled();
  });

  it("a mesma recusa numa inscrição que JÁ estava viva continua falha com retentativa", async () => {
    const l = loja({ status: "active", vagaOcupada: true });
    await l.tick();

    expect(l.enrollment.status).toBe("active");
    expect(l.enrollment.attempts).toBe(1);
    expect(l.enrollment.cancel_reason).toBeNull();
    expect(l.eventos.map((e) => e.event_type)).not.toContain("woke_into_taken_slot");
  });

  it("controle: com a vaga livre, a dormente acorda e segue o fluxo", async () => {
    const l = loja({ status: "dormente", vagaOcupada: false });
    await l.tick();

    expect(l.enrollment.current_node_id).toBe("fim");
    expect(l.enrollment.status).toBe("active");
    expect(l.eventos.map((e) => e.event_type)).not.toContain("woke_into_taken_slot");
  });
});

describe("só a recusa do índice de vaga vira o erro tipado", () => {
  it("23505 em idx_followup_enrollments_one_live → VagaDoContatoOcupadaError", () => {
    expect(erroDoPatch(RECUSA_DO_INDICE)).toBeInstanceOf(VagaDoContatoOcupadaError);
  });

  it("23505 de OUTRO índice continua erro comum", () => {
    const e = erroDoPatch({ code: "23505", message: 'duplicate key value violates unique constraint "outro_indice"' });
    expect(e).not.toBeInstanceOf(VagaDoContatoOcupadaError);
    expect(e.message).toContain("outro_indice");
  });

  it("erro sem código continua erro comum, com a mensagem original", () => {
    const e = erroDoPatch({ message: "connection reset" });
    expect(e).not.toBeInstanceOf(VagaDoContatoOcupadaError);
    expect(e.message).toBe("connection reset");
  });
});

describe("a trilha do acompanhamento diz por que encerrou", () => {
  it("o evento novo tem frase própria, em português, espanhol e inglês", () => {
    const r = descreveEvento(
      { id: "e1", node_id: "espera", event_type: "woke_into_taken_slot", payload: {}, created_at: AGORA.toISOString() },
      {},
      "pt-BR",
    );
    expect(r.titulo).toBe("Encerrado porque outro acompanhamento já cuida deste contato");
    const en = JSON.parse(readFileSync("lib/i18n/traducoes/en.json", "utf8")) as Record<string, string>;
    for (const frase of [r.titulo, r.detalhe ?? ""]) {
      expect(DICIONARIO[frase]?.es, `sem espanhol: ${frase}`).toBeTruthy();
      expect(en[frase], `sem inglês: ${frase}`).toBeTruthy();
    }
  });
});
