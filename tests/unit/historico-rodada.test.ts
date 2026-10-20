import { beforeEach, describe, expect, it, vi } from "vitest";

// ingest.ts importa @/lib/audit (→ supabase/server → validação de env).
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

// ESPIÕES: a rodada grava o passado e nada mais. Qualquer um destes chamado
// seria um efeito de mensagem NOVA (IA, demanda, push, carimbo da conversa).
const espioes = vi.hoisted(() => ({
  dispatch: vi.fn(),
  posEntrada: vi.fn(),
  marcar: vi.fn(),
}));
vi.mock("@/lib/waha/ingest", async (orig) => ({
  ...(await orig<typeof import("@/lib/waha/ingest")>()),
  dispatchWahaEvent: espioes.dispatch,
}));
vi.mock("@/lib/channels/pos-entrada", () => ({ aplicarEfeitosPosEntrada: espioes.posEntrada }));
vi.mock("@/lib/channels/marcar-conversa", () => ({ marcarConversaComMensagem: espioes.marcar }));

// O canal de mentira: a mesma página que o cliente devolve, sem HTTP.
const canal = vi.hoisted(() => ({
  chats: [] as Array<Record<string, unknown>>,
  mensagens: {} as Record<string, Array<Record<string, unknown>>>,
  falha: null as string | null,
  chamadas: [] as string[],
}));
vi.mock("@/lib/waha/client", () => ({
  getWahaClient: () => ({
    async paginaDeConversas(session: string, opts: { limit: number; offset: number }) {
      canal.chamadas.push(`chats:${session}:${opts.offset}`);
      const fatia = canal.chats.slice(opts.offset, opts.offset + opts.limit);
      const conversas = fatia
        .map((c, i) => ({ chatId: c.id as string, ultimaEm: (c.ultimaEm as number) ?? null, posicao: opts.offset + i }))
        .filter((c) => !c.chatId.endsWith("@g.us") && c.chatId !== "status@broadcast");
      return { conversas, lidas: fatia.length };
    },
    async listarMensagens(session: string, chatId: string, opts: { limit: number; offset: number; desde: number }) {
      canal.chamadas.push(`msgs:${session}:${chatId}:${opts.offset}:${opts.limit}`);
      if (canal.falha) throw new Error(canal.falha);
      return (canal.mensagens[chatId] ?? [])
        .filter((m) => typeof m.timestamp === "number" && (m.timestamp as number) >= opts.desde)
        .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
        .slice(opts.offset, opts.offset + opts.limit);
    },
  }),
}));

import { rodarUmaRodada } from "@/lib/whatsapp-historico/rodada";

const ORG = "org-1";
const SESSAO = "sess-1";
const IMP = "imp-1";
const agora = Math.floor(Date.now() / 1000);
const DIA = 86_400;

type Linha = Record<string, unknown>;

/** Banco em memória com as regras de que o desfecho depende: a unique
 * (organization_id, external_id) e a chave da conversa 1:1. */
function bancoDeMentira() {
  const importacoes = new Map<string, Linha>();
  const messages: Linha[] = [];
  const conversations = new Map<string, Linha>();
  const contatos = new Map<string, string>();
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const tabelasTocadas: string[] = [];
  let antesDoInsert: (() => void) | null = null;

  const colide = (l: Linha, contra: Linha[]) =>
    contra.some((m) => m.organization_id === l.organization_id && m.external_id === l.external_id);

  const admin = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "fn_upsert_wa_contact") {
        const chave = `${args.p_kind}:${args.p_kind === "lid" ? args.p_lid : args.p_phone}`;
        if (!contatos.has(chave)) contatos.set(chave, `ct-${contatos.size + 1}`);
        return Promise.resolve({ data: contatos.get(chave), error: null });
      }
      if (fn === "fn_upsert_wa_conversation_importada") {
        const existente = [...conversations.values()].find(
          (c) => c.organization_id === args.p_org && c.contact_id === args.p_contact && c.channel_session_id === args.p_session,
        );
        if (existente) return Promise.resolve({ data: existente.id, error: null });
        const id = `cv-${conversations.size + 1}`;
        conversations.set(id, {
          id,
          organization_id: args.p_org,
          contact_id: args.p_contact,
          channel_session_id: args.p_session,
          status: "closed",
          assigned_to_user_id: null,
        });
        return Promise.resolve({ data: id, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `rpc inesperada: ${fn}` } });
    },
    from(tabela: string) {
      tabelasTocadas.push(tabela);
      if (tabela === "importacoes_de_historico") {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: async () => ({ data: importacoes.has(id) ? { ...importacoes.get(id) } : null, error: null }),
            }),
          }),
          update: (patch: Linha) => ({
            eq: async (_c: string, id: string) => {
              const atual = importacoes.get(id);
              if (atual) importacoes.set(id, { ...atual, ...structuredClone(patch) });
              return { error: null };
            },
          }),
        };
      }
      if (tabela === "channel_sessions") {
        const q = {
          eq: () => q,
          maybeSingle: async () => ({ data: { waha_session_name: "nome-no-canal" }, error: null }),
        };
        return { select: () => q };
      }
      if (tabela === "messages") {
        return {
          select: () => {
            let org: unknown = null;
            let ids: unknown[] = [];
            const q = {
              eq: (_c: string, v: unknown) => ((org = v), q),
              in: (_c: string, v: unknown[]) => ((ids = v), q),
              then: (ok: (v: unknown) => unknown) =>
                Promise.resolve(
                  ok({
                    data: messages
                      .filter((m) => m.organization_id === org && ids.includes(m.external_id))
                      .map((m) => ({ external_id: m.external_id })),
                    error: null,
                  }),
                ),
            };
            return q;
          },
          insert: async (linhas: Linha | Linha[]) => {
            if (antesDoInsert) {
              const f = antesDoInsert;
              antesDoInsert = null;
              f();
            }
            const lote = Array.isArray(linhas) ? linhas : [linhas];
            const aceitas: Linha[] = [];
            for (const l of lote) {
              if (colide(l, messages) || colide(l, aceitas)) {
                return { error: { code: "23505", message: 'duplicate key value violates "messages_org_external_id_unique"' } };
              }
              aceitas.push(l);
            }
            messages.push(...aceitas.map((l) => structuredClone(l)));
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };

  return {
    admin,
    importacoes,
    messages,
    conversations,
    rpcs,
    tabelasTocadas,
    webhookAntesDoInsert(l: Linha) {
      antesDoInsert = () => messages.push(l);
    },
  };
}

function novaImportacao(db: ReturnType<typeof bancoDeMentira>, extra: Linha = {}) {
  db.importacoes.set(IMP, {
    id: IMP,
    organization_id: ORG,
    channel_session_id: SESSAO,
    status: "rodando",
    dias: 30,
    cursor: {},
    conversas_feitas: 0,
    mensagens_gravadas: 0,
    mensagens_existentes: 0,
    mensagens_ignoradas: 0,
    erro: null,
    ...extra,
  });
}

const TEL = "5511900000001@s.whatsapp.net";
const LID = "111111111111111@lid";

function acervoPadrao() {
  canal.chats = [
    { id: TEL, ultimaEm: agora - DIA },
    { id: "120363000000000001@g.us", ultimaEm: agora },
    { id: LID, ultimaEm: agora - DIA },
  ];
  canal.mensagens = {
    [TEL]: [
      { id: `false_${TEL}_A1`, from: TEL, fromMe: false, body: "oi", timestamp: agora - 3 * DIA, _data: { pushName: "Ana" } },
      { id: `true_${TEL}_A2`, from: "5511999999999@c.us", to: TEL, fromMe: true, body: "olá", timestamp: agora - 2 * DIA },
      // reação: não é fala, não vira linha
      { id: `false_${TEL}_A3`, from: TEL, type: "reaction", reaction: { text: "👍", messageId: "x" }, timestamp: agora - 2 * DIA + 1 },
      // sem id: não há como deduplicar, não vira linha
      { from: TEL, body: "sem id", timestamp: agora - 2 * DIA + 2 },
      // fora da janela de 30 dias
      { id: `false_${TEL}_A0`, from: TEL, body: "antiga", timestamp: agora - 40 * DIA },
    ],
    [LID]: [
      {
        id: `false_${LID}_B1`,
        from: LID,
        fromMe: false,
        body: "bom dia",
        timestamp: agora - 5 * DIA,
        _data: { key: { remoteJidAlt: "5511900000002@s.whatsapp.net" } },
      },
      { id: `true_${LID}_B2`, from: "5511999999999@c.us", to: LID, fromMe: true, body: "bom dia!", timestamp: agora - 4 * DIA },
    ],
  };
}

const SEM_TETO = { conversas: 1000, mensagens: 100_000 };

beforeEach(() => {
  canal.falha = null;
  canal.chamadas = [];
  espioes.dispatch.mockReset();
  espioes.posEntrada.mockReset();
  espioes.marcar.mockReset();
  acervoPadrao();
});

describe("rodarUmaRodada", () => {
  it("grava contato, conversa e mensagens marcadas como histórico, e conclui", async () => {
    const db = bancoDeMentira();
    novaImportacao(db);
    const r = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);

    expect(r).toEqual({ status: "concluida", gravadas: 4, existentes: 0 });
    // contato pela RPC do ingest, com o telefone canônico e, no @lid, o alternativo
    const contatos = db.rpcs.filter((x) => x.fn === "fn_upsert_wa_contact").map((x) => x.args);
    expect(contatos).toContainEqual(
      expect.objectContaining({ p_org: ORG, p_kind: "phone", p_phone: "+5511900000001", p_lid: null, p_chat_id: TEL, p_notify: "Ana" }),
    );
    expect(contatos).toContainEqual(
      expect.objectContaining({ p_org: ORG, p_kind: "lid", p_phone: "+5511900000002", p_lid: "111111111111111", p_chat_id: LID }),
    );
    expect(db.rpcs.filter((x) => x.fn === "fn_upsert_wa_conversation_importada").length).toBeGreaterThanOrEqual(2);
    expect(db.messages.map((m) => m.external_id).sort()).toEqual(
      [`false_${TEL}_A1`, "A2", `false_${LID}_B1`, "B2"].sort(),
    );
    for (const m of db.messages) {
      expect(m.metadata).toMatchObject({ historico_importado: "true" });
      expect(m.organization_id).toBe(ORG);
      expect(m.channel_session_id).toBe(SESSAO);
    }
    // a sessão é endereçada pelo nome no canal, não pelo id do CRM
    expect(canal.chamadas.every((c) => c.split(":")[1] === "nome-no-canal")).toBe(true);
    const imp = db.importacoes.get(IMP)!;
    expect(imp).toMatchObject({
      status: "concluida",
      conversas_feitas: 2,
      mensagens_gravadas: 4,
      mensagens_existentes: 0,
      mensagens_ignoradas: 2,
    });
  });

  it("guarda o `desde` no cursor na primeira rodada e o reusa nas seguintes", async () => {
    const db = bancoDeMentira();
    novaImportacao(db);
    await rodarUmaRodada(db.admin as never, IMP, { conversas: 1, mensagens: 300 });
    const desde = (db.importacoes.get(IMP)!.cursor as { desde: number }).desde;
    expect(desde).toBeGreaterThanOrEqual(agora - 30 * DIA - 5);
    expect(desde).toBeLessThanOrEqual(agora - 30 * DIA + 5);
    await rodarUmaRodada(db.admin as never, IMP, { conversas: 1, mensagens: 300 });
    expect((db.importacoes.get(IMP)!.cursor as { desde: number }).desde).toBe(desde);
  });

  it("retomada: rodadas de 1 conversa chegam ao MESMO total de uma rodada sem teto, sem repetir", async () => {
    const inteira = bancoDeMentira();
    novaImportacao(inteira);
    await rodarUmaRodada(inteira.admin as never, IMP, SEM_TETO);

    const fatiada = bancoDeMentira();
    novaImportacao(fatiada);
    const primeira = await rodarUmaRodada(fatiada.admin as never, IMP, { conversas: 1, mensagens: 300 });
    expect(primeira.status).toBe("rodando");
    expect(fatiada.messages.map((m) => m.external_id).sort()).toEqual([`false_${TEL}_A1`, "A2"].sort());
    expect(fatiada.importacoes.get(IMP)!.cursor).toMatchObject({ indiceConversa: 1, offsetMensagens: 0 });

    let ultima = primeira;
    for (let i = 0; i < 5 && ultima.status === "rodando"; i++) {
      ultima = await rodarUmaRodada(fatiada.admin as never, IMP, { conversas: 1, mensagens: 300 });
    }
    expect(ultima.status).toBe("concluida");
    const ids = fatiada.messages.map((m) => m.external_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(inteira.messages.map((m) => m.external_id).sort());
    const a = fatiada.importacoes.get(IMP)!;
    const b = inteira.importacoes.get(IMP)!;
    for (const k of ["conversas_feitas", "mensagens_gravadas", "mensagens_existentes", "mensagens_ignoradas"]) {
      expect(a[k]).toBe(b[k]);
    }
  });

  it("teto de mensagens corta no meio da conversa e a próxima rodada continua do offset", async () => {
    const db = bancoDeMentira();
    novaImportacao(db);
    const r = await rodarUmaRodada(db.admin as never, IMP, { conversas: 10, mensagens: 1 });
    expect(r).toMatchObject({ status: "rodando", gravadas: 1 });
    expect(db.importacoes.get(IMP)!.cursor).toMatchObject({ indiceConversa: 0, offsetMensagens: 1 });
    let ultima = r;
    for (let i = 0; i < 20 && ultima.status === "rodando"; i++) {
      ultima = await rodarUmaRodada(db.admin as never, IMP, { conversas: 10, mensagens: 1 });
    }
    expect(ultima.status).toBe("concluida");
    expect(db.messages).toHaveLength(4);
  });

  it("Foco 2: mensagem que o webhook já gravou conta como existente e não é inserida", async () => {
    const db = bancoDeMentira();
    novaImportacao(db);
    // o ao vivo grava a saída pelo id bare
    db.messages.push({ organization_id: ORG, external_id: "A2" });
    const r = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(r).toEqual({ status: "concluida", gravadas: 3, existentes: 1 });
    expect(db.messages.filter((m) => m.external_id === "A2")).toHaveLength(1);
    expect(db.importacoes.get(IMP)).toMatchObject({ mensagens_existentes: 1, mensagens_gravadas: 3 });
  });

  it("Foco 2: corrida com o webhook (23505 no insert) vira existente e a rodada segue", async () => {
    const db = bancoDeMentira();
    novaImportacao(db);
    db.webhookAntesDoInsert({ organization_id: ORG, external_id: `false_${TEL}_A1` });
    const r = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(r).toEqual({ status: "concluida", gravadas: 3, existentes: 1 });
    expect(db.messages.filter((m) => m.external_id === `false_${TEL}_A1`)).toHaveLength(1);
    expect(db.messages.map((m) => m.external_id)).toEqual(expect.arrayContaining(["A2", `false_${LID}_B1`, "B2"]));
  });

  it("Foco 3: conversa aberta já existente recebe as antigas sem mudar estado, dono, carimbo nem não lidas", async () => {
    const db = bancoDeMentira();
    novaImportacao(db);
    // o contato do TEL vai nascer como ct-1 (primeira conversa da lista)
    const antes = {
      id: "cv-aberta",
      organization_id: ORG,
      contact_id: "ct-1",
      channel_session_id: SESSAO,
      status: "open",
      assigned_to_user_id: "u-1",
      last_message_at: "2026-10-19T12:00:00.000Z",
      last_message_preview: "mensagem de ontem",
      last_message_direction: "inbound",
      unread_count_for_assignee: 3,
    };
    db.conversations.set("cv-aberta", { ...antes });
    await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(db.conversations.get("cv-aberta")).toEqual(antes);
    const daAberta = db.messages.filter((m) => m.conversation_id === "cv-aberta").map((m) => m.external_id);
    expect(daAberta.sort()).toEqual([`false_${TEL}_A1`, "A2"].sort());
    expect(db.tabelasTocadas).not.toContain("conversations");
  });

  it("erro do canal: status erro, mensagem gravada e cursor preservado", async () => {
    const db = bancoDeMentira();
    const cursor = { indiceConversa: 2, offsetMensagens: 0, desde: agora - 30 * DIA };
    novaImportacao(db, { cursor, mensagens_gravadas: 2 });
    canal.falha = "waha_messages_500";
    const r = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(r).toEqual({ status: "erro", gravadas: 0, existentes: 0 });
    const imp = db.importacoes.get(IMP)!;
    expect(imp.status).toBe("erro");
    expect(imp.erro).toContain("waha_messages_500");
    expect(imp.cursor).toEqual(cursor);
    expect(imp.mensagens_gravadas).toBe(2);
  });

  it("importação que não está rodando não roda", async () => {
    const db = bancoDeMentira();
    novaImportacao(db, { status: "cancelada" });
    await expect(rodarUmaRodada(db.admin as never, IMP, SEM_TETO)).rejects.toThrow("importacao_nao_esta_rodando");
    expect(canal.chamadas).toEqual([]);
  });

  it("nada dispara: sem dispatch, sem pós-entrada, sem carimbo da conversa, sem emit_event", async () => {
    const db = bancoDeMentira();
    novaImportacao(db);
    await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(espioes.dispatch).not.toHaveBeenCalled();
    expect(espioes.posEntrada).not.toHaveBeenCalled();
    expect(espioes.marcar).not.toHaveBeenCalled();
    const fns = new Set(db.rpcs.map((x) => x.fn));
    expect([...fns].sort()).toEqual(["fn_upsert_wa_contact", "fn_upsert_wa_conversation_importada"]);
    expect(new Set(db.tabelasTocadas)).toEqual(new Set(["importacoes_de_historico", "channel_sessions", "messages"]));
  });
});
