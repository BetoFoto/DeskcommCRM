/**
 * O EFEITO da anonimização sobre a comanda, com e sem o módulo `financeiro`
 * (PR #1907, migrations 0619/0620, D8/0485).
 *
 * As cercas vizinhas medem o REGISTRO: `cascata-lgpd-nao-encolhe` vê que `sales`
 * saiu da cascata e `lgpd-redact-unificado-alcanca-pelo-catalogo` vê que a seção
 * `financeiro/sales` está declarada. Nenhuma delas olha a COLUNA depois de
 * anonimizar — e foi a coluna que mostrou o defeito: com `cancel_reason` e
 * `reverse_reason` em `colunas_rotulo`, uma comanda finalizada sem cancelamento
 * saía com `cancel_reason = 'Cliente Anonimizado #N'`, porque o mecanismo da 0485
 * grava o rótulo em toda linha alcançada, inclusive onde a coluna era nula.
 *
 * Sabotagem medida: sem a declaração da seção, o segundo caso falha com o texto
 * da pessoa legível em `notes`.
 */
import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const ORG = "19070000-6666-4000-8000-000000000001";
const C_SEM = "19070000-5555-4000-8000-000000000001";
const C_COM = "19070000-5555-4000-8000-000000000002";
const C_VIZ = "19070000-5555-4000-8000-000000000003";
const PIX = "19070000-4444-4000-8000-000000000001";
const V1 = "19070000-3333-4000-8000-000000000001";
const V2 = "19070000-3333-4000-8000-000000000002";
const VV = "19070000-3333-4000-8000-000000000003";

describe("a comanda e a anonimização", () => {
  it("SEM o módulo: sales não existe e anonimizar o contato funciona", () => {
    sql(`
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${ORG}', 'tri-1907', 'Tri 1907', 'Tri 1907') on conflict (id) do nothing;
      insert into public.contacts (id, organization_id, name) values
        ('${C_SEM}', '${ORG}', 'Sem Modulo'),
        ('${C_COM}', '${ORG}', 'Com Modulo'),
        ('${C_VIZ}', '${ORG}', 'Vizinha')
        on conflict (id) do nothing;
    `);
    expect(sql(`select coalesce(to_regclass('public.sales')::text, 'ausente');`)).toBe("ausente");
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG}', '${C_SEM}', gen_random_uuid());`);
    expect(sql(`select is_anonymized::text from public.contacts where id = '${C_SEM}';`)).toBe("true");
  });

  it("COM o módulo: notes e motivos somem, nulo continua nulo, valor/status/vínculo ficam, vizinha intocada", () => {
    sql("select public.fn_financeiro_provisionar();");
    sql(`
      insert into public.payment_methods (id, organization_id, name)
        values ('${PIX}', '${ORG}', 'Pix') on conflict (id) do nothing;
      insert into public.sales (id, organization_id, number, contact_id, payment_method_id, status,
                                total_cents, notes, cancel_reason, reverse_reason, finalized_at, reversed_at)
      values
        ('${V1}', '${ORG}', 1, '${C_COM}', '${PIX}', 'finalized', 12345, 'Maria alergica a X', null,
         'Maria pediu estorno', now(), now()),
        ('${V2}', '${ORG}', 2, '${C_COM}', null, 'cancelled', 500, null, 'Maria desistiu', null, null, null),
        ('${VV}', '${ORG}', 3, '${C_VIZ}', '${PIX}', 'finalized', 999, 'nota da vizinha', null, null, now(), null)
      on conflict (id) do nothing;
    `);
    // controle de seed
    expect(sql(`select notes from public.sales where id = '${V1}';`)).toBe("Maria alergica a X");

    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG}', '${C_COM}', gen_random_uuid());`);

    const v1 = sql(`select concat_ws('|', coalesce(notes,'NULL'), coalesce(cancel_reason,'NULL'),
                       coalesce(reverse_reason,'NULL'), total_cents, status, contact_id)
                  from public.sales where id = '${V1}';`);
    const v2 = sql(`select concat_ws('|', coalesce(notes,'NULL'), coalesce(cancel_reason,'NULL'), total_cents, status)
                  from public.sales where id = '${V2}';`);
    const vv = sql(`select notes from public.sales where id = '${VV}';`);
    // Nada é INVENTADO: coluna que era nula continua nula (cancel_reason de V1).
    expect(v1).toBe(`NULL|NULL|NULL|12345|finalized|${C_COM}`);
    expect(v2).toBe(`NULL|NULL|500|cancelled`);
    expect(vv).toBe("nota da vizinha");
  });
});
