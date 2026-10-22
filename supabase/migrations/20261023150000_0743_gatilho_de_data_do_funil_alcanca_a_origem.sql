-- manifest: **O gatilho de data do funil (`lead.date_field_due`, entidade `crm_lead`) passa a alcançar a origem do atendimento — a mesma classe que o #2330 consertou para `contact.birthday` e os seis `appointment.*` (issue #3286).** O cron `app/api/v1/cron/lead-date-field-due` emite o evento com `p_entity_kind='crm_lead'` e SEM `service_origin` no payload, e `fn_service_event_contact` — a tabela única `(tipo, entidade) → contato` que o carimbo do `emit_event` e a resolução de `fn_service_event_origin` leem — não conhecia o par: nenhum ramo da função o alcançava, a resolução recusava com `service_event_origin_unsupported` (40001), `serviceForEvent` devolvia `null` e `serviceForAutomation` lançava `StaleServiceBoundaryError` — a ação de WhatsApp terminava `failed` sem erro em lugar nenhum. O par novo entra na lista `crm_lead` que a função já mantinha, ao lado de `lead.created/stage_changed/tag_added`: as DUAS pontas passam a reconhecê-lo pela mesma linha. Não se toca no emissor (a origem é DERIVADA pelo par, não inventada no cron) e nenhum par existente é afrouxado. A função parte da ÚLTIMA definição de `fn_service_event_contact`, a da 0670 (#2812), que pôs `contact.phone_added` no ramo de contato; partir da 0551 desfaria aquele conserto. Idempotente: `create or replace`; apêndice igual no fim do `baseline.sql`, antes da VARREDURA anon (0116).

-- ============================================================================
-- 0743 — O GATILHO DE DATA DO FUNIL ALCANÇA A ORIGEM (#3286)
--
-- O defeito medido na #3286, numa instalação real (1.87.0): TODA regra cujo
-- gatilho é "data do funil" (`lead.date_field_due`) e cuja ação é enviar
-- WhatsApp terminava `failed` com `service_boundary_stale`. No mesmo período a
-- regra de aniversário (`contact.birthday`), com o mesmo canal e a mesma conta,
-- enviava normalmente. A ação que NÃO fala com o cliente (criar tarefa, mover
-- card) rodava nas mesmas regras — o defeito é do par (tipo, entidade), não do
-- motor de automação.
--
-- ─── A causa ────────────────────────────────────────────────────────────────
--
-- O gatilho de data do funil é emitido por
-- `app/api/v1/cron/lead-date-field-due/route.ts` com
-- `p_event_type='lead.date_field_due'` e `p_entity_kind='crm_lead'`, e sem
-- `service_origin` no payload — pela razão certa: origem é campo reservado ao
-- SERVIDOR, e é o servidor que tem de escrevê-la.
--
-- As duas pontas que escrevem e leem essa origem consultam a MESMA tabela de
-- pares `(tipo, entidade) → contato`, `fn_service_event_contact`:
--
--   * o carimbo do `emit_event` (a resolução que vira `service_origin` no
--     instante da emissão) — sem o par, o evento nasce SEM origem;
--   * a resolução de `fn_service_event_origin` — sem o par, levanta
--     `service_event_origin_unsupported` (40001).
--
-- Como o `lead.date_field_due` não estava em nenhuma das listas, o evento
-- nascia sem origem E a resolução o recusava — não havia caminho. `40001` é
-- engolido por `serviceForEvent` como origem obsoleta, então `serviceForEvent`
-- devolvia `null` e `serviceForAutomation` lançava `StaleServiceBoundaryError`;
-- a ação terminava `failed` com a mensagem do invariante de fronteira, e nada
-- no log dizia qual era o defeito.
--
-- ─── O desenho ──────────────────────────────────────────────────────────────
--
-- A definição abaixo parte da ÚLTIMA de `fn_service_event_contact`, a da
-- 0670 (#2812), que acrescentou `contact.phone_added` ao ramo de contato. Partir
-- da 0551 (a primeira das duas no baseline) apagaria esse tipo e o gatilho
-- "ganhou telefone → WhatsApp" voltaria a morrer em `service_boundary_stale`.
--
-- O conserto é UMA linha: `lead.date_field_due` entra na lista de tipos que a
-- função já resolvia para `entity_kind='crm_lead'`, ao lado de
-- `lead.created`/`lead.stage_changed`/`lead.tag_added`. A entidade `crm_lead`
-- continua resolvendo o contato por `crm_leads.contact_id`, o MESMO caminho que
-- os três tipos de lead já usavam — nenhuma coluna, nenhuma tabela, nenhum
-- ramo novo, nenhum par afrouxado (tipo fora da lista continua `unsupported`, e
-- `entity_kind` incompatível continua `unsupported`).
--
-- NÃO se inventa `service_origin` no cron: a origem é DERIVADA pelo par, no
-- instante da emissão, pelo `emit_event` — exatamente como o #2330 fez para o
-- aniversário, que também é emitido por cron sem sessão.
--
-- ─── O que fica de fora, de propósito (mesma classe, issues próprias) ───────
--
-- Medido na mesma passada: os quatro tipos do encanamento do trigger de lead
-- (`lead.won`, `lead.lost`, `lead.reopened`, `lead.assigned`, com
-- `entity_kind='lead'` via `fn_log_event`) e os outros dois gatilhos de relógio
-- do funil (`lead.silent_for`, `lead.stage_stale`) continuam fora das duas
-- listas — mesma classe de defeito, decisão pendente, e entrar agora seria
-- afrouxar o reconhecimento de tipos cujo emissor não foi medido.
--
-- ─── A prova ────────────────────────────────────────────────────────────────
--
-- `tests/invariants/automation-send-whatsapp.test.ts`, casos 11 e 12: o gatilho
-- de data do funil dispara a AÇÃO inteira (o evento ganha carimbo e a mensagem
-- nasce, sem `service_boundary_stale`), e o par `(tipo, entidade)` reconhece o
-- novo SEM perder `contact.birthday`, `contact.tag_added` e
-- `appointment.created`, com o par desconhecido ainda recusado. Sem a linha
-- desta migration, o caso 11 termina `failed`/`service_boundary_stale` e o
-- caso 12 acusa `suportado=false` no par novo.
-- ============================================================================

create or replace function public.fn_service_event_contact(p_org uuid,p_event_type text,p_entity_kind text,p_entity_id uuid)
returns table(contact_id uuid,suportado boolean) language plpgsql stable security definer set search_path=public as $$
begin
 if p_event_type in ('lead.created','lead.stage_changed','lead.tag_added','lead.date_field_due') and p_entity_kind='crm_lead' then
   return query select (select l.contact_id from public.crm_leads l where l.organization_id=p_org and l.id=p_entity_id),true;
 elsif p_event_type in ('contact.tag_added','contact.birthday','contact.phone_added') and p_entity_kind='contact' then
   return query select (select c.id from public.contacts c where c.organization_id=p_org and c.id=p_entity_id),true;
 elsif p_event_type in ('appointment.created','appointment.confirmed','appointment.rescheduled','appointment.cancelled','appointment.completed','appointment.no_show') and p_entity_kind='calendar_appointment' then
   return query select (select a.contact_id from public.calendar_appointments a where a.organization_id=p_org and a.id=p_entity_id),true;
 else
   return query select null::uuid,false;
 end if;
end $$;
revoke all on function public.fn_service_event_contact(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.fn_service_event_contact(uuid,text,text,uuid) to service_role;

notify pgrst, 'reload schema';
