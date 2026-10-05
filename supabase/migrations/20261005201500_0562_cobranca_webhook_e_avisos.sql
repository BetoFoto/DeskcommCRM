-- 0562 — COBRANÇA DO REVENDEDOR, PR 3a: o webhook, os avisos e a reconciliação
--        (spec docs/superpowers/specs/2026-09-29-cobranca-do-revendedor-design.md §2.4, §2.5, §8, §11)
-- manifest: **Cobrança do revendedor, PR 3a: o webhook, os avisos e a reconciliação.** (A) `webhook_events_log_provider_check` ganha `stripe` e `asaas`, editado no bloco único do baseline (alargamento puro, issue #159). (B) `uniq_webhook_events_log_cobranca`: `(provider, external_id)` único só para os provedores de cobrança — a rota do webhook trata o `23505` (linha `processed` responde 200; `received` reemite o sinal). A linha de cobrança nasce com `organization_id` nulo e corpo `{id,type}`, invisível ao tenant pela própria policy. Apêndice antes da VARREDURA anon, depois do bloco do PR 2. Gate da 0562: `tests/invariants/cobranca-webhook-e-avisos.test.ts`.
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
--
-- No baseline, as seções que ALARGAM constraint de vocabulário editam o bloco
-- único dela (regra da issue #159); as demais entram no apêndice desta
-- migration, antes da VARREDURA anon.
-- Idempotente (`drop constraint if exists` + `add`, `if not exists`, `create or
-- replace`); sem BEGIN/COMMIT.
-- Gates: tests/invariants/cobranca-webhook-e-avisos.test.ts.

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
