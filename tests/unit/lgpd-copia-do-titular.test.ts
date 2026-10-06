/**
 * O ARQUIVO DE DADOS QUE O TITULAR RECEBE NÃO LEVA O QUE É DA EQUIPE
 * (doc 103, resposta A).
 *
 * O `data.json` passa a ir por link também no Brasil, e no Brasil e em
 * Portugal ele sai de `copiaDoTitular`. Este arquivo prova três coisas:
 *
 * 1. Nenhum campo da lista proibida sai. A lista está escrita AQUI, à mão, e
 *    não importada de `lib/lgpd/copia-do-titular.ts`: tirar um item de lá tem
 *    de deixar este teste vermelho, e uma lista importada concordaria com
 *    qualquer coisa. Todo valor proibido carrega a marca `SEGREDO`, e o teste
 *    procura a marca no arquivo INTEIRO — um caminho que a lista esqueça ainda
 *    é pego pelo texto.
 * 2. O que é do titular fica (marca `FICA`) — um filtro que apagasse tudo
 *    passaria no item 1.
 * 3. Isolamento: pelo caminho de produção (coletor + cópia), o que é de outro
 *    contato ou de outra organização não entra.
 *
 * O PDF não muda: ele é desenhado do payload inteiro, antes da cópia. Quem o
 * trava byte a byte são os fixtures de `lgpd-texto-segue-o-pais.test.tsx`;
 * aqui o teste garante que a cópia não altera o payload de onde o PDF sai.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mock.admin }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { copiaDoTitular } from "@/lib/lgpd/copia-do-titular";
import { collectExportData, type ExportPayload } from "@/lib/lgpd/export-collector";

/** Seções inteiras que não podem sair. */
const SECOES_PROIBIDAS = ["conversation_notes", "case_chat_messages"];

/** [seção, campo] que não pode sair de nenhuma linha. */
const CAMPOS_PROIBIDOS: Array<[string, string]> = [
  ["activities", "source_module"],
  ["appointments", "google_base_projection"],
  ["appointments", "google_conflict"],
  ["appointments", "google_pending_write"],
  ["appointments", "meeting_state"],
  ["sales", "notes"],
  ["case_events", "metadata"],
  ["passagens", "motor"],
  ["passagens", "origem"],
  ["avisos_de_caso", "destino_mascarado"],
  ["avisos_de_caso", "erro_codigo"],
  ["avisos_de_caso", "tentativas"],
  ["prospecting_candidates", "error"],
  ["b2b.pessoa", "notes"],
  ["b2b.vinculos", "notes"],
  ["b2b.linhas_importadas", "error"],
];

type Obj = Record<string, unknown>;
const linhas = (v: unknown): Obj[] =>
  Array.isArray(v) ? (v as Obj[]) : v && typeof v === "object" ? [v as Obj] : [];
const noCaminho = (raiz: Obj, caminho: string): Obj[] => {
  const [a, b] = caminho.split(".") as [string, string | undefined];
  return linhas(b === undefined ? raiz[a] : (raiz[a] as Obj | undefined)?.[b]);
};

/** Um payload com uma linha em cada seção que importa à lista. */
function payloadCheio(): ExportPayload {
  return {
    request_id: "FICA-protocolo",
    organization_id: "FICA-org",
    organization_legal_name: "FICA-razao",
    generated_at: "2026-10-06T00:00:00.000Z",
    contact: {
      id: "SEGREDO-contato-id",
      name: "FICA-nome",
      custom_fields: { pedido_id: "FICA-dentro-do-jsonb" },
      source_metadata: { ad_id: "FICA-anuncio" },
    },
    messages_recent: [
      { id: "SEGREDO-msg-id", conversation_id: "SEGREDO-conv-id", body: "FICA-mensagem" },
    ],
    leads: [{ id: "SEGREDO-l", pipeline_id: "SEGREDO-p", stage_id: "SEGREDO-s", title: "FICA-lead" }],
    orders: [{ id: "SEGREDO-o", external_id: "FICA-pedido-da-loja", status: "paid" }],
    activities: [{ id: "SEGREDO-a", lead_id: "SEGREDO-al", type: "FICA-tipo", source_module: "SEGREDO-modulo" }],
    appointments: [
      {
        id: "SEGREDO-ag",
        title: "FICA-consulta",
        notes: "FICA-anotacao-que-o-pdf-imprime",
        meeting_url: "FICA-link",
        google_base_projection: { x: "SEGREDO-g1" },
        google_conflict: { x: "SEGREDO-g2" },
        google_pending_write: { x: "SEGREDO-g3" },
        meeting_state: "SEGREDO-estado",
      },
    ],
    sales: [{ id: "SEGREDO-v", number: 7, notes: "SEGREDO-nota-comanda", cancel_reason: "FICA-cancelou" }],
    case_events: [
      {
        id: "SEGREDO-ce",
        case_id: "SEGREDO-cec",
        body: "FICA-evento",
        metadata: { destino_mascarado: "SEGREDO-plantao", entrega_id: "SEGREDO-ent" },
      },
    ],
    passagens: [
      {
        id: "SEGREDO-pa",
        conversation_id: "SEGREDO-pac",
        caso_id: "SEGREDO-paca",
        motor: "SEGREDO-motor",
        origem: "SEGREDO-origem",
        motivo_codigo: "FICA-motivo",
        notes: "FICA-ultimas-palavras-do-cliente",
        tentativas: ["FICA-tentativa"],
      },
    ],
    avisos_de_caso: [
      {
        id: "SEGREDO-av",
        case_id: "SEGREDO-avc",
        destino_mascarado: "SEGREDO-fone-funcionario",
        erro_codigo: "SEGREDO-erro",
        tentativas: "SEGREDO-n",
        status: "FICA-entregue",
      },
    ],
    prospecting_candidates: [
      { id: "SEGREDO-pc", campaign_id: "SEGREDO-pcc", place_id: "SEGREDO-place", error: "SEGREDO-e", phone: "FICA-fone" },
    ],
    conversation_notes: [{ id: "x", body: "SEGREDO-nota-interna", created_by_name: "SEGREDO-funcionario" }],
    case_chat_messages: [{ id: "y", body: "SEGREDO-chat-interno" }],
    ai_agent_runs: [{ id: "SEGREDO-run", tool_calls: [{ tool_name: "add_note", args: { text: "FICA-args" } }] }],
    b2b: {
      pessoa: { id: "SEGREDO-pe", full_name: "FICA-pessoa", notes: "SEGREDO-nota-b2b" },
      vinculos: [{ company_id: "SEGREDO-co", job_title: "FICA-cargo", notes: "SEGREDO-nota-vinculo" }],
      linhas_importadas: [
        { id: "SEGREDO-li", batch_id: "SEGREDO-lote", raw_data: { nome: "FICA-planilha" }, error: "SEGREDO-imp" },
      ],
    },
  } as unknown as ExportPayload;
}

describe("o arquivo do titular (data.json)", () => {
  it("não leva nenhuma seção nem campo da lista proibida", () => {
    const copia = copiaDoTitular(payloadCheio());
    for (const secao of SECOES_PROIBIDAS) expect(copia, secao).not.toHaveProperty(secao);
    for (const [secao, campo] of CAMPOS_PROIBIDOS) {
      const ls = noCaminho(copia, secao);
      expect(ls.length, `${secao}: a seção sumiu do teste`).toBeGreaterThan(0);
      for (const l of ls) expect(l, `${secao}.${campo}`).not.toHaveProperty(campo);
    }
  });

  it("não leva chave de banco de linha nenhuma — e nada marcado SEGREDO, em lugar nenhum", () => {
    const copia = copiaDoTitular(payloadCheio());
    const secoes = Object.entries(copia).flatMap(([k, v]) =>
      k === "b2b" ? Object.values(v as Obj).flatMap(linhas) : linhas(v),
    );
    for (const l of secoes)
      for (const campo of Object.keys(l))
        expect(campo === "id" || (campo.endsWith("_id") && campo !== "external_id"), campo).toBe(false);
    expect(JSON.stringify(copia).match(/SEGREDO[^"]*/g) ?? []).toEqual([]);
  });

  it("leva o que é do titular, inclusive chave dentro de um jsonb dele", () => {
    const tudo = JSON.stringify(payloadCheio());
    const copia = JSON.stringify(copiaDoTitular(payloadCheio()));
    const fica = tudo.match(/FICA-[a-z-]+/g)!;
    expect(fica.length).toBeGreaterThan(20);
    for (const marca of fica) expect(copia, marca).toContain(marca);
  });

  it("não altera o payload de onde o PDF é desenhado", () => {
    const data = payloadCheio();
    const antes = structuredClone(data);
    copiaDoTitular(data);
    expect(data).toEqual(antes);
  });

  it("o worker sobe a cópia, desenha o PDF do payload e assina o link para todo país", () => {
    const fonte = readFileSync(join(__dirname, "..", "..", "workers", "lgpd-export-worker.ts"), "utf8");
    expect(fonte).toContain("JSON.stringify(copiaDoTitular(data), null, 2)");
    expect(fonte).toContain("renderLgpdPdf(data,");
    expect(fonte).toContain(".createSignedUrl(jsonPath, expiresInSec)");
    // O link do arquivo era pedido só fora do Brasil; o país não pode voltar a decidir isso.
    expect(fonte).not.toContain("PAIS_PADRAO");
  });
});

// ---------------------------------------------------------------------------
// Isolamento, pelo caminho de produção: coletor → cópia
// ---------------------------------------------------------------------------

const ORG = "org-a";
const OUTRA_ORG = "org-b";
const CONTATO = "contato-a";
const OUTRO_CONTATO = "contato-b";

type Row = Record<string, unknown>;
let banco: Record<string, Row[]>;

/** Banco falso que aplica `eq`/`in` como o Postgres; método que não conhece não filtra. */
function consulta(tabela: string): unknown {
  const eqs: [string, unknown][] = [];
  const ins: [string, unknown[]][] = [];
  let colunas = "";
  let faixa: [number, number] = [0, Number.MAX_SAFE_INTEGER];
  const executar = async () => {
    const data = (banco[tabela] ?? [])
      .filter((r) => eqs.every(([k, v]) => r[k] === v))
      .filter((r) => ins.every(([k, vs]) => vs.includes(r[k])))
      .slice(faixa[0], faixa[1] + 1)
      .map((r) =>
        colunas.includes("*") || colunas === ""
          ? r
          : Object.fromEntries(colunas.split(",").map((c) => c.trim()).map((c) => [c, r[c]])),
      );
    return { data, error: null, count: data.length };
  };
  const q: unknown = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then")
          return (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => executar().then(ok, erro);
        if (prop === "maybeSingle" || prop === "single")
          return async () => {
            const r = await executar();
            return { ...r, data: r.data[0] ?? null };
          };
        if (prop === "select")
          return (c: string) => {
            colunas = c;
            return q;
          };
        if (prop === "eq")
          return (k: string, v: unknown) => {
            eqs.push([k, v]);
            return q;
          };
        if (prop === "in")
          return (k: string, vs: unknown[]) => {
            ins.push([k, vs]);
            return q;
          };
        if (prop === "range")
          return (de: number, ate: number) => {
            faixa = [de, ate];
            return q;
          };
        return () => q;
      },
    },
  );
  return q;
}

const linha = (dono: { org: string; contato: string }, extra: Row): Row => ({
  organization_id: dono.org,
  contact_id: dono.contato,
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});

beforeEach(() => {
  const meu = { org: ORG, contato: CONTATO };
  const doVizinho = { org: ORG, contato: OUTRO_CONTATO };
  const daOutraOrg = { org: OUTRA_ORG, contato: CONTATO };
  banco = {
    organizations: [{ id: ORG, legal_name: "Empresa A", display_name: "A", dpo_email: null }],
    contacts: [
      { id: CONTATO, organization_id: ORG, name: "MEU-nome", created_at: "2026-01-01T00:00:00Z" },
      { id: CONTATO, organization_id: OUTRA_ORG, name: "OUTRA-ORG-nome", created_at: "2026-01-01T00:00:00Z" },
    ],
    conversations: [
      linha(meu, { id: "conv-meu", status: "open", channel: "whatsapp" }),
      linha(doVizinho, { id: "conv-vizinho", status: "open", channel: "whatsapp" }),
      linha(daOutraOrg, { id: "conv-outra-org", status: "open", channel: "whatsapp" }),
    ],
    messages: [
      linha(meu, { id: "m1", conversation_id: "conv-meu", body: "MEU-mensagem", direction: "in" }),
      linha(doVizinho, { id: "m2", conversation_id: "conv-vizinho", body: "VIZINHO-mensagem", direction: "in" }),
      linha(daOutraOrg, { id: "m3", conversation_id: "conv-outra-org", body: "OUTRA-ORG-mensagem", direction: "in" }),
    ],
    crm_leads: [
      linha(meu, { id: "l1", title: "MEU-lead" }),
      linha(doVizinho, { id: "l2", title: "VIZINHO-lead" }),
      linha(daOutraOrg, { id: "l3", title: "OUTRA-ORG-lead" }),
    ],
    lead_notes: [
      linha(meu, { id: "n1", headline: "MEU-memoria", body: "MEU-memoria-corpo" }),
      linha(doVizinho, { id: "n2", headline: "VIZINHO-memoria", body: "x" }),
      linha(daOutraOrg, { id: "n3", headline: "OUTRA-ORG-memoria", body: "x" }),
    ],
  };
  mock.admin.mockReturnValue({ from: consulta, rpc: async () => ({ data: null, error: null }) });
});

describe("isolamento do arquivo do titular", () => {
  it("leva o que é dele e nada de outro contato nem de outra organização", async () => {
    const data = await collectExportData({
      organizationId: ORG,
      requestId: "pedido-1",
      contactId: CONTATO,
      externalCustomerId: null,
      pais: "BR",
    });
    const arquivo = JSON.stringify(copiaDoTitular(data));
    for (const meu of ["MEU-nome", "MEU-mensagem", "MEU-lead", "MEU-memoria"]) expect(arquivo, meu).toContain(meu);
    expect(arquivo.match(/(VIZINHO|OUTRA-ORG)-[a-z-]+/g) ?? []).toEqual([]);
  });
});
