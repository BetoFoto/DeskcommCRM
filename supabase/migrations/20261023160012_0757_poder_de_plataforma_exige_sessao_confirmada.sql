-- manifest: o poder de PLATAFORMA (`fn_is_platform_admin_full`, o ramo `scope = 'full'` das policies de escrita e das funções que o consultam) passa a exigir a sessão confirmada pelo código (`aal2`) de quem tem fator verificado; sem fator cadastrado nada muda (a verificação é opcional), e o papel dentro da própria organização segue como estava.
--
-- O app já cobra o código de quem age pelo poder de plataforma
-- (`mfaEmDivida` → `agindoPeloPoderDePlataforma`, `mfaEmDividaEstrita`), e a
-- 0747 fez o mesmo na anonimização; esta migration leva a mesma régua ao banco
-- inteiro. A régua é a da 0747: `aal2` do GoTrue, ou nenhum
-- fator `totp` verificado. Dispositivo confiável NÃO conta — ele vale na
-- organização onde a pessoa é admin, e lá quem autoriza é o papel
-- (`fn_role_at_least` / `fn_user_org_ids`), não esta função.
--
-- Uma definição só, e não uma guarda em cada policy: são dezenas de policies e
-- funções que perguntam `fn_is_platform_admin_full()`, e todas passam a
-- responder igual. A checagem de fator fica DENTRO do `exists`, para que só a
-- linha de um admin de plataforma pague a consulta a `auth.mfa_factors`.
-- `create or replace` preserva os grants da função (só authenticated e
-- service_role, desde o apêndice que a criou).
create or replace function public.fn_is_platform_admin_full()
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid() and pa.revoked_at is null and pa.scope = 'full'
      and (coalesce(auth.jwt()->>'aal','aal1') = 'aal2' or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = pa.user_id and f.factor_type = 'totp' and f.status = 'verified'))
  );
$$;
revoke execute on function public.fn_is_platform_admin_full() from public, anon;
grant execute on function public.fn_is_platform_admin_full() to authenticated, service_role;
