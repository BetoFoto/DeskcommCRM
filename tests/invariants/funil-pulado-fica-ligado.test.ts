import { describe, expect, it } from "vitest";

import { sql, lastLine } from "./gov-helpers";

/**
 * O PASSO "FUNIL" PULADO NÃO DEIXA A ORGANIZAÇÃO COM O QUADRO MUDO (issue #2451).
 *
 * `trg_seed_default_pipeline_for_org` semeia o funil "Pedidos" com 8 etapas de
 * e-commerce e NENHUMA com `agent_stage_hint`. O passo do wizard troca esse
 * quadro por um do ramo do negócio (a 0156) — mas o mesmo passo tem "Pular por
 * enquanto", e `pularQuadro` só grava `funil.skipped` no estado do onboarding.
 * Quem pula termina a instalação com `coberturaDoFunil()` em `mudo: true`: o
 * agente não move UM card até alguém abrir o mapeamento à mão.
 *
 * Aqui se mede o caminho do PULO — a escrita que `pularQuadro` faz de fato
 * (`patchOnboardingState(orgId, { funil: { skipped: true } })` →
 * `organizations.onboarding_state`), e não uma chamada de conveniência num
 * helper: conserto que só existe numa função que ninguém chama deixa este
 * arquivo vermelho, que é onde ele tem de ficar.
 *
 * O mapeamento é o único honesto para este funil, e a própria 0084 já o
 * declarou: `Aguardando pagamento` negocia, `Pago` ganha, `Cancelado` perde — e
 * `Carrinho abandonado`, `Em separação`, `Enviado`, `Entregue` e `Pós-venda`
 * não têm equivalente no funil do agente. Forçar um deles seria inventar
 * semântica que o tenant não declarou; `null` é estado legítimo (0084).
 *
 * ⚠️ CADA CASO MONTA E DESMONTA O PRÓPRIO TENANT — mesma razão da 0156: um
 * caso que herdasse o quadro já ligado pelo anterior mediria a precondição
 * errada e passaria por sorte.
 */

/** Um tenant com o funil que `trg_seed_default_pipeline_for_org` semeia. */
function criarTenant(slug: string): { org: string; pipeline: string } {
  const out = sql(`
    insert into public.organizations (slug, display_name, legal_name, status)
    values ('${slug}', '${slug}', '${slug}', 'active')
    on conflict (slug) do update set display_name = excluded.display_name;
    select o.id::text, p.id::text
      from public.organizations o
      join public.crm_pipelines p on p.organization_id = o.id and p.is_default
     where o.slug = '${slug}';
  `);
  const [org, pipeline] = lastLine(out).split("|");
  return { org: org ?? "", pipeline: pipeline ?? "" };
}

/**
 * O que `pularQuadro` grava, do lado do banco: um merge de topo em
 * `onboarding_state` com `funil` inteiro substituído por `{ skipped: true }`
 * (`{ ...state, ...patch }` em `patchOnboardingState`).
 */
function pularOPassoDoFunil(org: string): void {
  sql(`
    update public.organizations
       set onboarding_state = coalesce(onboarding_state, '{}'::jsonb)
                              || '{"funil":{"skipped":true}}'::jsonb
     where id = '${org}'::uuid;
  `);
}

/** `total|quantas_com_hint` — a mesma régua da 0156. */
function quadro(pipeline: string): string {
  return lastLine(
    sql(`
      select count(*)::text || '|' ||
             count(*) filter (where agent_stage_hint is not null)::text
        from public.crm_stages where pipeline_id = '${pipeline}'::uuid;
    `),
  );
}

describe("2451 · quem pula o passo do funil não fica com o agente mudo", () => {
  it("a organização que pulou termina com as etapas semeadas ligadas", () => {
    const { org, pipeline } = criarTenant("inv-2451-pulado");

    // A precondição do defeito: nasce mudo, como a medição da 0156.
    expect(quadro(pipeline)).toBe("8|0");

    pularOPassoDoFunil(org);

    // O pulo fica registrado (sem isto o caso mediria "não fez nada").
    expect(
      lastLine(
        sql(`select coalesce(onboarding_state->'funil'->>'skipped', '(ausente)')
              from public.organizations where id = '${org}'::uuid;`),
      ),
    ).toBe("true");

    // E o funil semeado nasce ligado: 8 colunas, 3 com passo do agente.
    expect(quadro(pipeline)).toBe("8|3");
  });

  it("liga o passo que a coluna significa, e só esse", () => {
    const { org, pipeline } = criarTenant("inv-2451-mapeamento");
    pularOPassoDoFunil(org);

    const estado = lastLine(
      sql(`
        select string_agg(name || '/' || coalesce(agent_stage_hint, '-'), ', '
                         order by position)
          from public.crm_stages where pipeline_id = '${pipeline}'::uuid;
      `),
    );
    expect(estado).toBe(
      "Carrinho abandonado/-, Aguardando pagamento/negotiating, Pago/won, " +
        "Em separação/-, Enviado/-, Entregue/-, Pós-venda/-, Cancelado/lost",
    );

    // A régua que a tela do agente lê (`coberturaDoFunil`): com 'negotiating'
    // apontado, `mudo` vira false — é o alarme que tinha de sumir.
    const cobertura = lastLine(
      sql(`
        select count(*) filter (
                 where agent_stage_hint in ('new','contacted','qualifying',
                                            'qualified','negotiating')
               )::text
          from public.crm_stages where pipeline_id = '${pipeline}'::uuid;
      `),
    );
    expect(cobertura).toBe("1");
  });

  it("o funil de quem NÃO pulou continua como a 0156 deixou — e é só dele", () => {
    // Isolamento de tenant: o pular de A não pode mexer em B, que ainda está
    // no caminho normal do wizard.
    const a = criarTenant("inv-2451-isol-a");
    const b = criarTenant("inv-2451-isol-b");

    pularOPassoDoFunil(a.org);

    expect(quadro(a.pipeline)).toBe("8|3");
    expect(quadro(b.pipeline)).toBe("8|0");
  });

  it("pular de novo é idempotente: nada muda e nada duplica", () => {
    const { org, pipeline } = criarTenant("inv-2451-idempotente");
    pularOPassoDoFunil(org);
    pularOPassoDoFunil(org);

    expect(quadro(pipeline)).toBe("8|3");
    expect(
      lastLine(
        sql(`select count(*)::text from public.crm_stages
              where pipeline_id = '${pipeline}'::uuid;`),
      ),
    ).toBe("8");
  });
});
