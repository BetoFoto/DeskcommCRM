-- 0556 — Gestão de tenants pelo admin da plataforma: exclusão completa e
-- transacional, o inventário de arquivos da organização no Storage e o aviso
-- de troca de e-mail de login na Central (PR #1967, de @Draven9; nasceu com
-- outro número e foi renumerada no recorte — a suspensão e o corte de RLS que
-- ela trazia saíram: a suspensão é a da 0501, e o corte vira item de revisão).
--
-- ── A. EXCLUSÃO COMPLETA DA ORGANIZAÇÃO ──────────────────────────────────────
--
-- Não existia exclusão de tenant. Um `delete from organizations` avulso
-- cascateia por ~155 tabelas, mas tem três armadilhas medidas no mapa de
-- dependências (29/09/2026):
--
--  * R1 — lead atribuído a agente de IA: o BEFORE DELETE de `ai_agents` solta
--    o lead, o UPDATE dispara `emit_event`, e o INSERT em `event_log` aponta
--    para a organização que a própria cascata acabou de apagar → a FK falha e a
--    transação inteira aborta. Apagar os leads ANTES, com a org viva, tira esse
--    caminho da cascata.
--  * `webhook_events_log` não tem FK para `organizations`: sobraria com o corpo
--    cru dos webhooks (telefones, textos). É apagada explicitamente.
--  * A auditoria sobrevive (FK `set null`), mas perde a atribuição. Por isso a
--    função grava ANTES uma lápide (`organization.deleted`) com `resource_id` =
--    a organização — é por ela que a trilha continua achável — e o resumo do que
--    a LGPD exige guardar (`lgpd_requests`, que o cascade apaga).
--
-- Pré-condição: a organização precisa estar SUSPENSA, e a suspensão precisa ser
-- ADMINISTRATIVA. A exclusão é o segundo passo de uma decisão, nunca o primeiro
-- — e a suspensão já deixou o tenant parado (nada sai pelos workers, 0501)
-- antes de sumir. Suspensão por COBRANÇA é recusada (`PT409`
-- `organizacao_com_cobranca_pendente`): excluir a empresa deixaria a assinatura
-- cobrando no provedor. Tipo nulo vale como administrativa (regra de
-- `lib/organizacao/operante.ts`). A rota confere o mesmo antes de tocar em
-- nada; aqui é conferido de novo porque `fn_suspender_organizacao` pode trocar
-- o tipo entre a leitura da rota e esta transação.
--
-- Roda SÓ como servidor (service_role, `auth.uid()` nulo): o gatilho
-- `fn_followup_generation_write` recusa DELETE em `job_queue` vindo de sessão
-- de usuário, e a exclusão não é ato de membro nenhum.

create or replace function public.fn_excluir_organizacao(
  p_org uuid,
  p_actor uuid,
  p_confirmacao text,
  p_motivo text,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_org record;
  v_membros uuid[];
  v_removiveis uuid[];
  v_contagens jsonb;
  v_lgpd jsonb;
  v_suporte jsonb;
  v_tabela regclass;
  v_sobra bigint;
begin
  if auth.uid() is not null then
    raise exception 'organizacao_exclusao_so_pelo_servidor' using errcode = '42501';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'organizacao_exclusao_sem_motivo' using errcode = '22023';
  end if;

  select id, slug, display_name, legal_name, cnpj, status, suspended_kind, created_at
    into v_org
    from public.organizations
   where id = p_org
   for update;
  if not found then
    raise exception 'organizacao_inexistente' using errcode = 'PT404';
  end if;
  if v_org.status <> 'suspended' then
    raise exception 'organizacao_nao_suspensa' using errcode = 'PT409';
  end if;
  if coalesce(v_org.suspended_kind, 'administrativa') = 'cobranca' then
    raise exception 'organizacao_com_cobranca_pendente' using errcode = 'PT409';
  end if;
  if p_confirmacao is distinct from v_org.slug then
    raise exception 'organizacao_confirmacao_divergente' using errcode = '22023';
  end if;

  select coalesce(array_agg(user_id), '{}') into v_membros
    from public.user_organizations where organization_id = p_org;

  select jsonb_build_object(
    'membros', coalesce(array_length(v_membros, 1), 0),
    'contatos', (select count(*) from public.contacts where organization_id = p_org),
    'conversas', (select count(*) from public.conversations where organization_id = p_org),
    'mensagens', (select count(*) from public.messages where organization_id = p_org),
    'leads', (select count(*) from public.crm_leads where organization_id = p_org),
    'canais', (select count(*) from public.channel_sessions where organization_id = p_org)
  ) into v_contagens;

  -- O que a LGPD exige guardar e o cascade apagaria: o atendimento a titular
  -- (tipo, situação, prazos). Sem conteúdo nem contato — só a prova de que o
  -- pedido existiu e como terminou.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'tipo', request_type, 'escopo', scope, 'origem', source,
           'situacao', status, 'recebido_em', received_at, 'prazo', due_at,
           'concluido_em', completed_at) order by received_at), '[]'::jsonb)
    into v_lgpd
    from public.lgpd_requests where organization_id = p_org;

  -- Quem da plataforma entrou nesta organização: o registro some com o cascade.
  select coalesce(jsonb_agg(jsonb_build_object(
           'ator', actor_user_id, 'modo', access_mode,
           'inicio', created_at, 'fim', ended_at) order by created_at), '[]'::jsonb)
    into v_suporte
    from public.platform_support_sessions where organization_id = p_org;

  -- A lápide: `organization_id` nulo de propósito (a linha sobrevive à
  -- exclusão sem depender do SET NULL), `resource_id` = a organização.
  insert into public.api_audit_log
    (organization_id, actor_user_id, acting_as_platform_admin, action,
     resource_type, resource_id, request_id, bypassed_rls, metadata)
  values
    (null, p_actor, true, 'organization.deleted', 'organization', p_org,
     p_request_id, true,
     jsonb_build_object(
       'slug', v_org.slug, 'display_name', v_org.display_name,
       'legal_name', v_org.legal_name, 'cnpj', v_org.cnpj,
       'criada_em', v_org.created_at, 'motivo', btrim(p_motivo),
       'suspended_kind', coalesce(v_org.suspended_kind, 'administrativa'),
       'contagens', v_contagens, 'lgpd_requests', v_lgpd,
       'acompanhamentos_de_suporte', v_suporte));

  -- R1: tira o caminho agente → lead → event_log da cascata.
  delete from public.crm_leads where organization_id = p_org;

  -- Sem FK para organizations: sairia órfã com o corpo cru dos webhooks.
  delete from public.webhook_events_log
   where organization_id = p_org
      or channel_session_id in (select id from public.channel_sessions where organization_id = p_org);

  delete from public.organizations where id = p_org;

  -- Conferência: nenhuma tabela pode guardar linha desta organização — vale
  -- também para as tabelas que módulos criam em runtime (ADR-0002).
  for v_tabela in
    select a.attrelid::regclass
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid and c.relkind = 'r'
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where a.attname = 'organization_id' and not a.attisdropped
  loop
    execute format('select count(*) from %s where organization_id = $1', v_tabela)
      into v_sobra using p_org;
    if v_sobra > 0 then
      raise exception 'organizacao_exclusao_incompleta: % linha(s) em %', v_sobra, v_tabela
        using errcode = 'P0001';
    end if;
  end loop;

  -- Logins que pertenciam SÓ a esta organização. Quem tem vínculo com outra
  -- (inclusive revogado — o CASCADE de `auth.users` apagaria o histórico de lá),
  -- é admin da plataforma ou conduziu acompanhamento em outra org fica.
  select coalesce(array_agg(u), '{}') into v_removiveis
    from unnest(v_membros) as u
   where not exists (select 1 from public.user_organizations where user_id = u)
     and not exists (select 1 from public.platform_admins where user_id = u)
     and not exists (select 1 from public.platform_support_sessions where actor_user_id = u);

  return jsonb_build_object(
    'organizacao', p_org,
    'slug', v_org.slug,
    'contagens', v_contagens,
    'membros', to_jsonb(v_membros),
    'usuarios_removiveis', to_jsonb(v_removiveis));
end;
$f$;

revoke execute on function public.fn_excluir_organizacao(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_excluir_organizacao(uuid, uuid, text, text, text) to service_role;

-- ── B. ARQUIVOS DA ORGANIZAÇÃO NO STORAGE ────────────────────────────────────
--
-- Todo bucket tenant-aware guarda sob `<organization_id>/…` (whatsapp-media,
-- ai-policy, lgpd-exports, skill-assets, brand-logos, catalog-photos,
-- org-sounds). A API do Storage só lista uma pasta por vez; esta função devolve
-- o inventário inteiro pelo prefixo, para a exclusão remover pela API (apagar
-- `storage.objects` direto deixaria o arquivo no backend).

create or replace function public.fn_arquivos_da_organizacao(p_org uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public, storage
as $f$
  select o.bucket_id, o.name
    from storage.objects o
   where o.name like p_org::text || '/%';
$f$;

revoke execute on function public.fn_arquivos_da_organizacao(uuid) from public, anon, authenticated;
grant execute on function public.fn_arquivos_da_organizacao(uuid) to service_role;

-- ── C. agent_inbox_items.kind ganha 'email_de_login_trocado' ─────────────────
-- A troca do e-mail de login de um membro pelo admin da plataforma
-- (`PATCH /api/v1/admin/tenants/[id]/members/[userId]/email`) abre um aviso na
-- Central da empresa — com o nome da pessoa e a data, NUNCA o endereço —, para
-- que uma troca indevida não passe em silêncio. Lista COMPLETA da 0501 (a
-- última que reconstruiu a constraint) mais o kind novo: esta passa a ser a
-- última migration que a reconstrói (kind-check-migration-x-baseline). No
-- baseline, o kind entra no bloco único da constraint, não num bloco novo.
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
    -- (migration 0500) os dois avisos do Jev.
    'jev_pedido_de_humano',
    'jev_parar_de_receber',
    -- (migration 0501) a organização voltou de uma suspensão e há conversas para revisar.
    'org_reativada',
    -- (migration 0556) o admin da plataforma trocou o e-mail de login de uma
    -- pessoa da equipe: a empresa fica sabendo pela Central (sem endereço).
    'email_de_login_trocado',
    'other'
  ));
