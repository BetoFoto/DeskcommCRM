-- 0562 — COBRANÇA DO REVENDEDOR, PR 3a: o webhook, os avisos e a reconciliação
--        (spec docs/superpowers/specs/2026-09-29-cobranca-do-revendedor-design.md §2.4, §2.5, §8, §11)
-- manifest: **Cobrança do revendedor, PR 3a: o webhook, os avisos e a reconciliação.** (A) `webhook_events_log_provider_check` ganha `stripe` e `asaas`, editado no bloco único do baseline (alargamento puro, issue #159). (B) `uniq_webhook_events_log_cobranca`: `(provider, external_id)` único só para os provedores de cobrança — a rota do webhook trata o `23505` (linha `processed` responde 200; `received` reemite o sinal). A linha de cobrança nasce com `organization_id` nulo e corpo `{id,type}`, invisível ao tenant pela própria policy. Apêndice antes da VARREDURA anon, depois do bloco do PR 2. (C) `agent_inbox_items_kind_check` ganha `cobranca` no bloco único do baseline (lista completa; esta passa a ser a última migration que a reconstrói): avisos da régua à empresa, sem referência, e o de 80% do teto de IA do plano, com `ref_kind='plano'`; os dois abrem Plano e cobrança, só para o admin. (D) `fn_cobranca_reconciliaveis()` — o predicado único de quem a reconciliação relê (§8): o cron filtra `precisa_reler` e a Visão geral lê `max(relida_em)` do mesmo conjunto; INVOKER, EXECUTE só do `service_role`. Gate da 0562: `tests/invariants/cobranca-reconciliacao.test.ts`, `tests/unit/kind-check-migration-x-baseline.test.ts`, `tests/invariants/vocabulario-banco-x-typescript.test.ts`, `tests/invariants/cobranca-webhook-e-avisos.test.ts`.
--
-- ── A causa ───────────────────────────────────────────────────────────────────
-- A cobrança passa a falar com um provedor de pagamento (Stripe nesta PR; o
-- Asaas chega na 3b, no mesmo contrato). O provedor avisa por webhook, e o aviso
-- é só PONTEIRO: toda decisão vem da releitura na API do provedor. O arquivo do
-- webhook precisa aceitar os dois provedores e recusar o mesmo evento duas vezes.
--
-- ── O que muda ────────────────────────────────────────────────────────────────
-- A. `webhook_events_log_provider_check` ganha 'stripe' e 'asaas'.
-- B. `uniq_webhook_events_log_cobranca`: um evento de cobrança, uma linha.
-- C. `agent_inbox_items_kind_check` ganha 'cobranca': avisos da régua e do teto de IA.
-- D. `fn_cobranca_reconciliaveis()`: quem a reconciliação relê, num predicado só.
--
-- No baseline, as seções que ALARGAM constraint de vocabulário editam o bloco
-- único dela (regra da issue #159); as demais entram no apêndice desta
-- migration, antes da VARREDURA anon.
-- Idempotente (`drop constraint if exists` + `add`, `if not exists`, `create or
-- replace`); sem BEGIN/COMMIT.
-- Toda função nova perde EXECUTE de public, anon e authenticated.
-- Gates: tests/invariants/cobranca-webhook-e-avisos.test.ts, cobranca-reconciliacao.test.ts.

-- ── A. o arquivo do webhook aceita os provedores de cobrança ─────────────────
-- Lista COMPLETA do bloco único do baseline (0151, alargado pela 0387) mais
-- 'stripe' e 'asaas'. Alargamento puro: linha que passava continua passando.
-- A linha de cobrança nasce com organization_id NULO, cabeçalhos NULOS e corpo
-- {id,type}: a policy de leitura da tabela vale para qualquer membro, e é a org
-- nula que a esconde do tenant (spec §2.4).
alter table public.webhook_events_log
  drop constraint if exists webhook_events_log_provider_check;
alter table public.webhook_events_log
  add constraint webhook_events_log_provider_check check (provider in (
    'waha', 'nuvemshop', 'generic', 'meta_cloud', 'zernio', 'datafy', 'stripe', 'asaas'
  ));

-- ── B. um evento de cobrança, uma linha ─────────────────────────────────────
-- A rota grava a linha ANTES de emitir o sinal, e o provedor reentrega. O 23505
-- deste índice é a idempotência: linha `processed` → 200 sem reemitir; linha
-- `received` → reemite (o emit anterior falhou; o consumidor relê, então
-- reemitir é inofensivo). Parcial: o arquivo dos canais não muda. Nenhuma
-- linha desses provedores existia antes do CHECK acima, então não há o que
-- deduplicar antes de criar o índice.
create unique index if not exists uniq_webhook_events_log_cobranca
  on public.webhook_events_log (provider, external_id)
  where provider in ('stripe', 'asaas');

-- ── C. a Central da empresa ganha os avisos da cobrança ──────────────────────
-- Lista COMPLETA do bloco único do baseline (kind-check-migration-x-baseline):
-- esta passa a ser a última migration que reconstrói a constraint. 'cobranca'
-- é o aviso da régua (teste acabando, venceu, suspende em breve, suspensa) e o
-- de 80% do teto de IA do plano (ref_kind plano). Os dois abrem Configurações ›
-- Plano e cobrança, só para quem administra a empresa.
alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;
alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required','appointment_recovery_review','qr_rescan','routing_unassigned',
    'job_dead','event_dead','budget_exceeded','handoff','promotion_review','judge_unaligned',
    'followup_dead','snooze_expired','next_action_ambiguous','risk_backlog_seeded',
    'reactivation_expired','capabilities_missing','message_send_stuck','midia_nao_lida',
    'channel_template_review','channel_number_alert','promise_unfulfilled','contact_proposal_expired',
    'budget_warning','conhecimento_nao_indexado','voice_call_missed','case_stale',
    'aviso_de_caso_nao_entregue','followup_sem_agente','canal_mudo_sem_numero',
    'proposal_expired_notice','proposal_acceptance_rate_drop','proposal_promised_not_created',
    'proposta_travada',
    'proposta_pronta_para_revisao',
    'org_reativada',
    'jev_pedido_de_humano','jev_parar_de_receber',
    -- os avisos da cobrança do revendedor à empresa.
    'cobranca',
    'other'
  ));

-- ── D. quem a reconciliação relê: um predicado só ────────────────────────────
-- A reconciliação (cron da cobrança, §8) relê pela API as assinaturas com
-- provedor cujo estado ainda pode mudar sem aviso nosso: toda não cancelada; a
-- cancelada de org suspensa POR COBRANÇA (pode ter reassinado e pago por boleto
-- com o webhook perdido); e a cancelada com checkout dos últimos 30 dias (o
-- checkout pode ter virado pagamento). `precisa_reler` diz quem entra na
-- rodada: nunca lida, lida há mais de 6h, ou com o aviso final dado em org
-- ativa e sem leitura da última hora (a régua só suspende com leitura < 1h).
-- A Visão geral de /admin/cobranca lê max(relida_em) deste MESMO conjunto.
-- INVOKER: quem chama é o service_role, que já lê as duas tabelas.
create or replace function public.fn_cobranca_reconciliaveis()
returns table (organization_id uuid, relida_em timestamptz, precisa_reler boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.organization_id,
         a.relida_em,
         (a.relida_em is null
          or a.relida_em < now() - interval '6 hours'
          or (o.status = 'active'
              and a.ultimo_aviso = 'suspende_em_breve'
              and a.relida_em < now() - interval '1 hour')) as precisa_reler
    from public.cobranca_assinaturas a
    join public.organizations o on o.id = a.organization_id
   where a.provedor is not null
     and (a.estado <> 'cancelada'
          or (o.status = 'suspended' and o.suspended_kind = 'cobranca')
          or a.checkout_expira_em > now() - interval '30 days');
$$;

revoke execute on function public.fn_cobranca_reconciliaveis() from public, anon, authenticated;
grant execute on function public.fn_cobranca_reconciliaveis() to service_role;
