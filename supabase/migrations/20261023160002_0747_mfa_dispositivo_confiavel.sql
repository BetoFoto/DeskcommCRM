-- manifest: MFA — dispositivo confiável por 30 dias: tabela `mfa_trusted_devices` (hash do token do cookie + fator provado + sessão reconhecida, só service_role escreve) e `fn_session_mfa_proven` passa a aceitar a sessão reconhecida por dispositivo confiável dentro do prazo, e fica executável por authenticated para o app perguntar ao banco.
--
-- O segundo fator é cobrado em DOIS lugares: no app (`mfaEmDivida`) e no banco
-- (`fn_session_mfa_proven`, chamada por agenda, resposta, roteamento, conexões,
-- anonimização). O JWT de quem entra por dispositivo confiável continua `aal1` —
-- só o GoTrue emite `aal2`, e só depois de um código —, então a confiança mora
-- aqui, amarrada ao `session_id` do JWT, e o app pergunta a esta função.

create table if not exists public.mfa_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- O fator que o código provou. Sem FK (auth.mfa_factors é do GoTrue): a função
  -- abaixo exige que ele ainda exista, então remover o fator por QUALQUER caminho
  -- (desligar, código de recuperação, script de suporte) mata a confiança junto.
  factor_id uuid not null,
  token_hash text not null unique,
  session_id uuid,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null
);
create index if not exists mfa_trusted_devices_user_idx on public.mfa_trusted_devices (user_id);

-- Sem policy, e sem grant para quem fala com o PostgREST: quem pudesse gravar
-- aqui o próprio `session_id` dispensaria o segundo fator sozinho. Só o servidor
-- (service_role) escreve, e só depois de um código provado ou de um token de
-- dispositivo que o próprio servidor emitiu.
alter table public.mfa_trusted_devices enable row level security;
revoke all on table public.mfa_trusted_devices from anon, authenticated;

-- A mesma pergunta que as definer de agenda, resposta, roteamento etc. já fazem,
-- com uma terceira saída: a sessão foi reconhecida por um dispositivo confiável
-- ainda dentro do prazo. Exposta a `authenticated` (é `stable`, só fala da
-- própria sessão) para que o app pergunte AO BANCO em vez de manter uma segunda
-- regra que pudesse divergir desta.
create or replace function public.fn_session_mfa_proven()
returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and (coalesce(auth.jwt()->>'aal','aal1')='aal2' or not exists(
  select 1 from auth.mfa_factors where user_id=auth.uid() and factor_type='totp' and status='verified')
  or exists(select 1 from public.mfa_trusted_devices d
   join auth.mfa_factors f on f.id=d.factor_id and f.user_id=d.user_id and f.status='verified'
   where d.user_id=auth.uid() and d.session_id::text=auth.jwt()->>'session_id' and d.expires_at>now()));
$$;
revoke all on function public.fn_session_mfa_proven() from public, anon;
grant execute on function public.fn_session_mfa_proven() to authenticated;
