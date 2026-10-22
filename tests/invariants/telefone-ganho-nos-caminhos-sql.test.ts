import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * #3315 — os DOIS caminhos em SQL que preenchem telefone de ficha vazia passam a
 * emitir `contact.phone_added`, e só na TRANSIÇÃO.
 *
 * A issue lista quatro caminhos que gravavam em silêncio; dois deles são
 * TypeScript (cobertos pelos dublês em `lib/channels/zernio/` e
 * `tests/unit/contacts/`) e dois moram DENTRO do banco, onde dublê nenhum
 * alcança: a RPC que a ingestão chama (`fn_upsert_wa_contact`) e a fusão de
 * fichas (`fn_mesclar_contatos`). Este arquivo é o único lugar onde a emissão
 * real — a linha em `event_log` — pode ser medida.
 *
 * O que ele prende, caminho por caminho:
 *
 *   1. `fn_upsert_wa_contact` preenche a ficha vazia → UM `contact.phone_added`,
 *      com o contato e a org certos e o número canônico no payload.
 *   2. A SEGUNDA chamada com o mesmo número não emite — a ficha já não estava
 *      vazia (é o lado "não emitir" que um contador de emissões não pegaria).
 *   3. A PROMOÇÃO de grafia (12 → 13 dígitos do MESMO número) não é ganho de
 *      telefone: o contato já era alcançável naquele número, e a issue nomeia o
 *      evento como "ganhar um telefone", não "mudar a escrita dele".
 *   4. Contato NOVO não emite: ninguém ganhou nada — nasceu com o número.
 *   5. `fn_mesclar_contatos` com o vencedor VAZIO herda o número do perdedor →
 *      UM evento para o VENCEDOR (é ele que passa a ser alcançável).
 *   6. A fusão em que o vencedor JÁ tinha número não emite: o `coalesce` do passo
 *      dele descarta o número do perdedor, então não houve transição nenhuma.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});

const ORG = "e3315000-0000-4000-8000-000000000001";

/**
 * Números SINTÉTICOS do teste. NUNCA copiados de log: a saída das ferramentas
 * do repo REDIGE telefone, e o literal copiado chega em asteriscos — que o CHECK
 * de E.164 reprova.
 */
const NUMERO_DA_FICHA_VAZIA = "+5541991234567";
/** Mesmo número, escrito SEM o nono dígito: é o formato que a RPC promove. */
const GRAFIA_CURTA = "+554198765432";
const NUMERO_PROMOVIDO = "+5541998765432";
const NUMERO_DO_SECUNDARIO = "+5541977776666";
const NUMERO_DO_VENCEDOR = "+5541966665555";

const LID_VAZIA = "3315001";
const ID_VAZIA = "e3315000-0000-4000-8000-000000000101";
const ID_PROMOCAO = "e3315000-0000-4000-8000-000000000102";
const ID_VENCEDOR_VAZIO = "e3315000-0000-4000-8000-000000000104";
const ID_VENCEDOR_COM_NUMERO = "e3315000-0000-4000-8000-000000000105";
const ID_SECUNDARIO = "e3315000-0000-4000-8000-000000000106";

async function contato(
  id: string,
  campos: { telefone?: string | null; lid?: string | null } = {},
): Promise<string> {
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number, source_metadata, is_anonymized)
     values ($1, $2, $3, $4, $5, false)`,
    [
      id,
      ORG,
      "Ficha 3315",
      campos.telefone ?? null,
      campos.lid ? JSON.stringify({ waha_lid: campos.lid }) : "{}",
    ],
  );
  return id;
}

/** O que a ficha ficou — a gravação que o evento descreve. */
async function telefoneDe(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ phone_number: string | null }>(
    "select phone_number from contacts where id = $1",
    [id],
  );
  return rows[0]?.phone_number ?? null;
}

/** As emissões de `contact.phone_added` deste contato, na ordem em que saíram. */
async function eventosDe(
  id: string,
): Promise<Array<{ entity_kind: string; entity_id: string; organization_id: string; payload: Record<string, unknown>; metadata: Record<string, unknown> }>> {
  const { rows } = await pool.query(
    `select entity_kind, entity_id, organization_id, payload, metadata
       from event_log
      where organization_id = $1 and entity_id = $2 and event_type = 'contact.phone_added'
      order by created_at`,
    [ORG, id],
  );
  return rows;
}

async function upsertWaContato(
  kind: string,
  phone: string | null,
  lid: string | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "select public.fn_upsert_wa_contact($1, $2, $3, $4, $5, $6) as id",
    [ORG, kind, phone, lid, "chat-3315", "Ficha 3315"],
  );
  return rows[0]!.id;
}

async function mesclar(principal: string, secundarios: string[]) {
  const { rows } = await pool.query<{ r: Record<string, unknown> }>(
    "select public.fn_mesclar_contatos($1, $2, $3) as r",
    [ORG, principal, secundarios],
  );
  return rows[0]!.r;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-3315-telefone', 'Telefone LTDA', 'Telefone')
     on conflict (id) do nothing`,
    [ORG],
  );
  await contato(ID_VAZIA, { lid: LID_VAZIA });
  await contato(ID_PROMOCAO, { telefone: GRAFIA_CURTA });
  await contato(ID_VENCEDOR_VAZIO);
  await contato(ID_VENCEDOR_COM_NUMERO, { telefone: NUMERO_DO_VENCEDOR });
  await contato(ID_SECUNDARIO, { telefone: NUMERO_DO_SECUNDARIO });
});

afterAll(async () => {
  await pool.end();
});

describe("#3315 — `fn_upsert_wa_contact` emite na transição", () => {
  it("a ficha SEM número que ganha um emite UMA vez, com o contato e o número canônicos", async () => {
    const id = await upsertWaContato("lid", NUMERO_DA_FICHA_VAZIA, LID_VAZIA);
    expect(id).toBe(ID_VAZIA);
    // O evento descreve uma gravação que aconteceu.
    expect(await telefoneDe(ID_VAZIA)).toBe(NUMERO_DA_FICHA_VAZIA);

    const eventos = await eventosDe(ID_VAZIA);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      entity_kind: "contact",
      entity_id: ID_VAZIA,
      organization_id: ORG,
      payload: { phone_number: NUMERO_DA_FICHA_VAZIA },
    });
  });

  it("a SEGUNDA chamada com o mesmo número NÃO emite — a ficha já não estava vazia", async () => {
    await upsertWaContato("lid", NUMERO_DA_FICHA_VAZIA, LID_VAZIA);
    expect(await eventosDe(ID_VAZIA)).toHaveLength(1);
  });

  it("CONTROLE: sem número no payload não há ganho nem evento", async () => {
    const id = await upsertWaContato("lid", null, LID_VAZIA);
    expect(id).toBe(ID_VAZIA);
    expect(await eventosDe(ID_VAZIA)).toHaveLength(1);
  });

  it("a PROMOÇÃO de grafia (12→13 do MESMO número) NÃO é ganho de telefone", async () => {
    const id = await upsertWaContato("phone", GRAFIA_CURTA, null);
    expect(id).toBe(ID_PROMOCAO);
    // A grafia curta virou a canônica — e o contato continua alcançável no MESMO
    // número: ele não ganhou nenhum.
    expect(await telefoneDe(ID_PROMOCAO)).toBe(NUMERO_PROMOVIDO);
    expect(await eventosDe(ID_PROMOCAO)).toHaveLength(0);
  });

  it("contato NOVO não emite — ninguém ganhou um telefone, ele nasceu com um", async () => {
    const id = await upsertWaContato("phone", "+5541955554444", null);
    // A função INSERE um contato novo (id aleatório): o que se afirma é que ninguém
    // ganhou nada — e por isso não há evento nenhum para ele.
    expect(id).not.toBe(ID_VAZIA);
    expect(await telefoneDe(id)).toBe("+5541955554444");
    expect(await eventosDe(id)).toHaveLength(0);
  });
});

describe("#3315 — `fn_mesclar_contatos` emite para quem passa a ser alcançável", () => {
  it("o vencedor VAZIO que herda o número do perdedor emite UMA vez", async () => {
    await mesclar(ID_VENCEDOR_VAZIO, [ID_SECUNDARIO]);
    expect(await telefoneDe(ID_VENCEDOR_VAZIO)).toBe(NUMERO_DO_SECUNDARIO);

    const eventos = await eventosDe(ID_VENCEDOR_VAZIO);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      entity_kind: "contact",
      entity_id: ID_VENCEDOR_VAZIO,
      organization_id: ORG,
      payload: { phone_number: NUMERO_DO_SECUNDARIO },
    });
  });

  it("o vencedor que JÁ tinha número não emite — o `coalesce` descarta o do perdedor", async () => {
    const perdedor = "e3315000-0000-4000-8000-000000000107";
    await contato(perdedor, { telefone: "+5541944443333" });
    await mesclar(ID_VENCEDOR_COM_NUMERO, [perdedor]);
    // O vencedor ficou com o SEU número: nenhuma transição de vazio para cheio.
    expect(await telefoneDe(ID_VENCEDOR_COM_NUMERO)).toBe(NUMERO_DO_VENCEDOR);
    expect(await eventosDe(ID_VENCEDOR_COM_NUMERO)).toHaveLength(0);
  });
});
