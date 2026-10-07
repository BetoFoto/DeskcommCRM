-- manifest: **A pausa de uma conexão ganha um item na Central de avisos, que se resolve sozinho (issue #2389).** Pausar e retomar era silencioso para todo mundo menos para quem clicou: quem estava no celular, no plantão ou em outro turno continuava achando que o número estava no ar, e a retomada também não avisava — o audit já registra `channel.disabled` / `channel.enabled` (`lib/audit/actions.ts:260-261`), mas audit é histórico para quem procura, não comunicação. A migration só ACRESCENTA `canal_pausado` ao vocabulário fechado de `agent_inbox_items.kind` (drop/re-add preservando os 38 valores atuais, padrão da 0105), e a regra que abre/fecha o item mora em `lib/channels/canal-pausado.ts` (pura) + `lib/channels/central-de-pausa.ts` (banco), chamada pelos handlers de pausa/retoma e de arquivamento: a MESMA rodada abre e fecha o aviso, no formato do laço do `canal-mudo-watcher`, só que instantâneo. Pausa abre UM item por canal com o rótulo, o autor e o horário; repetir a pausa atualiza o corpo em vez de abrir um segundo; retomar resolve o MESMO item com motivo `reativado` e arquivar/excluir resolve com `canal_arquivado` (nunca órfão — lição do #1023). Canal fora do ar por SAÚDE (`STOPPED`/`FAILED`) não gera este item: quem avisa disso é o `channel-health`, e o tipo `CanalAvaliado` nem carrega `status`. Auto-curativa e idempotente: a lista só CRESCE, nenhuma linha existente viola a constraint nova e não há dado a corrigir.

-- 0583 — `agent_inbox_items.kind` ganha 'canal_pausado'
--
-- Por quê: pausar uma conexão é decisão de EQUIPE, e a única pessoa informada
-- era a que clicou. A Central de avisos (`agent_inbox_items`) é onde a
-- operação inteira olha — é lá que este item nasce, e é lá que ele morre
-- sozinho, sem clique de ninguém: aviso que só some no clique de alguém vira
-- lista que ninguém lê (lição do #1023).
--
-- Vocabulário FECHADO por CHECK: `add constraint` SUBSTITUI a constraint
-- inteira, então a lista abaixo é a completa — os 38 valores vigentes, na
-- mesma ordem do `baseline.sql`, mais o novo. Encurtar a lista apagaria o
-- aviso de alguém em silêncio (é o que a 0129 fez), e
-- `tests/unit/kind-check-migration-x-baseline.test.ts` cobra a igualdade valor
-- a valor com o baseline; `tests/unit/migrations-nao-encolhem-vocabulario`
-- cobra que ela não encolha.
--
-- Idempotente e auto-curativo: nenhum dado viola a constraint nova.

alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;

alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required',
    'appointment_recovery_review',
    'qr_rescan',
    'routing_unassigned',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'conhecimento_nao_indexado',
    'voice_call_missed',
    'case_stale',
    'aviso_de_caso_nao_entregue',
    'followup_sem_agente',
    'canal_mudo_sem_numero',
    'proposal_expired_notice',
    'proposal_acceptance_rate_drop',
    'proposal_promised_not_created',
    'proposta_travada',
    'proposta_pronta_para_revisao',
    'org_reativada',
    'jev_pedido_de_humano',
    'jev_parar_de_receber',
    'canal_pausado',
    'other'
  ));

-- 0583
