-- manifest: **Período de 180 dias na importação do histórico do WhatsApp (#999).** O CHECK de `importacoes_de_historico.dias` (0705) aceitava 30, 90 e 365; passa a aceitar também 180, que a tela (`components/connections/ChannelHistorico.tsx`) e o zod da rota (`app/api/v1/channel-sessions/[id]/historico/route.ts`) oferecem no mesmo commit. Só alarga o vocabulário: nenhuma linha existente viola o CHECK novo. `drop constraint if exists` + `add constraint` com o nome que o Postgres deu ao CHECK em linha da 0705; idempotente; apêndice igual no fim do `baseline.sql`. Gate: `tests/invariants/importacoes-de-historico-rls.test.ts`.

-- ---- período de 180 dias na importação do histórico (migration 0706, #999) ----
--
-- A 0705 já está aplicada onde a importação rodou (prova de 21/10), e o
-- `create table if not exists` dela não refaz o CHECK: daí uma migration nova
-- em vez de editar a 0705. Tela, rota e banco mudam no MESMO commit, ou a
-- prévia de 180 dias falha com 23514 no insert.

alter table public.importacoes_de_historico
  drop constraint if exists importacoes_de_historico_dias_check;
alter table public.importacoes_de_historico
  add constraint importacoes_de_historico_dias_check
  check (dias in (30, 90, 180, 365));

notify pgrst, 'reload schema';
