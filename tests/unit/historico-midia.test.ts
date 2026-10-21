import { beforeEach, describe, expect, it, vi } from "vitest";

const auditEspiao = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({ audit: auditEspiao }));

const canal = vi.hoisted(() => ({
  mensagens: [] as Array<Record<string, unknown>>,
  /** id da mensagem no canal -> o que `baixarMidiaDaMensagem` devolve (ou lança). */
  midia: {} as Record<string, { url: string | null; erro: boolean } | "lanca">,
  baixadas: [] as Array<[string, string, string]>,
}));
vi.mock("@/lib/waha/client", () => ({
  getWahaClient: () => ({
    async paginaDeConversas(_s: string, opts: { limit: number; offset: number }) {
      const todas = [{ chatId: "5511900000001@s.whatsapp.net", ultimaEm: null, posicao: 0 }];
      const fatia = todas.slice(opts.offset, opts.offset + opts.limit);
      return { conversas: fatia, lidas: fatia.length };
    },
    async paginaDeMensagens(_s: string, _c: string, opts: { limit: number; offset: number }) {
      const bruto = canal.mensagens.slice(opts.offset, opts.offset + opts.limit);
      return { mensagens: bruto, lidas: bruto.length };
    },
    async baixarMidiaDaMensagem(sessao: string, chatId: string, messageId: string) {
      canal.baixadas.push([sessao, chatId, messageId]);
      const r = canal.midia[messageId];
      if (r === "lanca") throw new Error("waha_media_500");
      return r ?? { url: null, erro: false };
    },
  }),
}));

import { rodarUmaRodada } from "@/lib/channels/historico/rodada";

const ORG = "org-1";
const IMP = "imp-1";
const TEL = "5511900000001@s.whatsapp.net";
const agora = Math.floor(Date.now() / 1000);
type Linha = Record<string, unknown>;

function bancoDeMentira() {
  const importacoes = new Map<string, Linha>();
  const messages: Linha[] = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const admin = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "fn_upsert_wa_contact") return Promise.resolve({ data: "ct-1", error: null });
      if (fn === "fn_upsert_wa_conversation_importada") return Promise.resolve({ data: "cv-1", error: null });
      if (fn === "emit_event") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: { message: `rpc inesperada: ${fn}` } });
    },
    from(tabela: string) {
      if (tabela === "importacoes_de_historico") {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: async () => ({ data: importacoes.has(id) ? { ...importacoes.get(id) } : null, error: null }),
            }),
          }),
          update: (patch: Linha) => {
            const filtros: Array<[string, unknown]> = [];
            const q = {
              eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
              select: async () => {
                const alvos = [...importacoes.values()].filter((l) => filtros.every(([c, v]) => l[c] === v));
                for (const l of alvos) importacoes.set(l.id as string, { ...l, ...structuredClone(patch) });
                return { data: alvos.map((l) => ({ id: l.id })), error: null };
              },
            };
            return q;
          },
        };
      }
      if (tabela === "channel_sessions") {
        const q = { eq: () => q, maybeSingle: async () => ({ data: { waha_session_name: "nome-no-canal" }, error: null }) };
        return { select: () => q };
      }
      if (tabela === "messages") {
        return {
          select: () => {
            let ids: unknown[] = [];
            const q = {
              eq: () => q,
              in: (_c: string, v: unknown[]) => ((ids = v), q),
              then: (ok: (v: unknown) => unknown) =>
                Promise.resolve(
                  ok({ data: messages.filter((m) => ids.includes(m.external_id)).map((m) => structuredClone(m)), error: null }),
                ),
            };
            return q;
          },
          insert: async (linhas: Linha | Linha[]) => {
            for (const l of Array.isArray(linhas) ? linhas : [linhas]) {
              messages.push({ id: `m-${messages.length + 1}`, media_url: null, ...structuredClone(l) });
            }
            return { error: null };
          },
          update: (patch: Linha) => {
            const filtros: Array<[string, unknown]> = [];
            const q = {
              eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
              then: (ok: (v: unknown) => unknown) => {
                for (const m of messages.filter((x) => filtros.every(([c, v]) => x[c] === v))) {
                  Object.assign(m, structuredClone(patch));
                }
                return Promise.resolve(ok({ error: null }));
              },
            };
            return q;
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
  return { admin, importacoes, messages, rpcs };
}

function novaImportacao(db: ReturnType<typeof bancoDeMentira>, extra: Linha = {}) {
  db.importacoes.set(IMP, {
    id: IMP,
    organization_id: ORG,
    channel_session_id: "sess-1",
    status: "rodando",
    dias: 30,
    cursor: {},
    conversas_feitas: 0,
    mensagens_gravadas: 0,
    mensagens_existentes: 0,
    mensagens_ignoradas: 0,
    midias_baixadas: 0,
    midias_indisponiveis: 0,
    erro: null,
    ...extra,
  });
}

const idCanal = (n: string) => `false_${TEL}_${n}`;
function imagem(n: string, ts: number): Linha {
  return {
    id: idCanal(n),
    timestamp: ts,
    from: TEL,
    fromMe: false,
    body: "",
    hasMedia: true,
    media: { url: null, mimetype: "image/jpeg", filename: null },
    _data: { key: { remoteJid: TEL, fromMe: false, id: n }, message: { imageMessage: { mimetype: "image/jpeg" } } },
  };
}
function audio(n: string, ts: number): Linha {
  return {
    id: idCanal(n),
    timestamp: ts,
    from: TEL,
    fromMe: false,
    body: "",
    hasMedia: true,
    media: { url: null, mimetype: "audio/ogg; codecs=opus", filename: null },
    _data: {
      key: { remoteJid: TEL, fromMe: false, id: n },
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
    },
  };
}
const SEM_TETO = { conversas: 1000, mensagens: 100_000, chamadas: 10_000 };
const emits = (db: ReturnType<typeof bancoDeMentira>) => db.rpcs.filter((r) => r.fn === "emit_event");

beforeEach(() => {
  canal.mensagens = [];
  canal.midia = {};
  canal.baixadas = [];
  auditEspiao.mockReset();
});

describe("mídia do histórico", () => {
  it("imagem com URL: grava media_url, pede a persistência como o ingest e conta", async () => {
    canal.mensagens = [imagem("I1", agora - 86_400)];
    canal.midia[idCanal("I1")] = { url: "http://canal/files/i1.jpg", erro: false };
    const db = bancoDeMentira();
    novaImportacao(db);
    const r = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);

    expect(r.status).toBe("concluida");
    expect(canal.baixadas).toEqual([["nome-no-canal", TEL, idCanal("I1")]]);
    const msg = db.messages[0]!;
    expect(msg.media_url).toBe("http://canal/files/i1.jpg");
    // as outras chaves da metadata ficam
    expect(msg.metadata).toMatchObject({ historico_importado: "true" });
    expect(emits(db)).toHaveLength(1);
    expect(emits(db)[0]!.args).toEqual({
      p_event_type: "media.persist_requested",
      p_entity_kind: "message",
      p_entity_id: msg.id,
      p_payload: { message_id: msg.id, conversation_id: "cv-1" },
      p_metadata: { source: "historico_importado" },
      p_organization_id: ORG,
    });
    expect(db.importacoes.get(IMP)).toMatchObject({ midias_baixadas: 1, midias_indisponiveis: 0 });
  });

  it("Foco 5: media.error vira indisponivel, a rodada segue e não tenta de novo", async () => {
    canal.mensagens = [audio("A1", agora - 86_400), imagem("I2", agora - 80_000)];
    canal.midia[idCanal("A1")] = { url: null, erro: true };
    canal.midia[idCanal("I2")] = { url: "http://canal/files/i2.jpg", erro: false };
    const db = bancoDeMentira();
    novaImportacao(db);
    const r = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);

    expect(r.status).toBe("concluida");
    const a1 = db.messages.find((m) => m.external_id === idCanal("A1"))!;
    expect(a1.metadata).toEqual({ historico_importado: "true", media_status: "indisponivel" });
    expect(a1.media_url).toBeNull();
    expect(emits(db)).toHaveLength(1);
    expect(db.importacoes.get(IMP)).toMatchObject({ midias_baixadas: 1, midias_indisponiveis: 1 });

    // nova passada pelo mesmo acervo: as mensagens já existem e nenhuma está `pendente`
    canal.baixadas = [];
    novaImportacao(db);
    await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(canal.baixadas).toEqual([]);
    expect(emits(db)).toHaveLength(1);
  });

  it("vídeo, documento e figurinha: nenhuma chamada de mídia", async () => {
    canal.mensagens = ["video", "document", "sticker"].map((tipo, i) => ({
      id: idCanal(`F${i}`),
      timestamp: agora - 86_400 + i,
      from: TEL,
      fromMe: false,
      body: "",
      hasMedia: true,
      type: tipo,
      media: { url: null, mimetype: "application/octet-stream", filename: null },
    }));
    const db = bancoDeMentira();
    novaImportacao(db);
    await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(db.messages).toHaveLength(3);
    expect(db.messages.every((m) => (m.metadata as Linha).media_status === "fora_do_escopo")).toBe(true);
    expect(canal.baixadas).toEqual([]);
    expect(emits(db)).toHaveLength(0);
  });

  it("exceção do canal na mídia: rodada em erro, cursor no último ponto firme, tenta depois", async () => {
    canal.mensagens = [imagem("I3", agora - 86_400)];
    canal.midia[idCanal("I3")] = "lanca";
    const db = bancoDeMentira();
    novaImportacao(db);
    const r = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(r.status).toBe("erro");
    expect(db.importacoes.get(IMP)!.erro).toContain("waha_media_500");
    expect(db.importacoes.get(IMP)!.cursor).toMatchObject({ indiceConversa: 0, offsetMensagens: 0 });
    // a mensagem ficou `pendente`: a próxima rodada tenta de novo
    expect((db.messages[0]!.metadata as Linha).media_status).toBe("pendente");
    canal.midia[idCanal("I3")] = { url: "http://canal/files/i3.jpg", erro: false };
    db.importacoes.set(IMP, { ...db.importacoes.get(IMP)!, status: "rodando" });
    const r2 = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(r2.status).toBe("concluida");
    expect(db.messages).toHaveLength(1);
    expect(db.messages[0]!.media_url).toBe("http://canal/files/i3.jpg");
  });

  it("download que lança sempre: rodadas 1 e 2 em erro (tentativas 1 e 2), a 3 desiste e segue", async () => {
    canal.mensagens = [imagem("Q1", agora - 90_000), imagem("Q2", agora - 80_000)];
    canal.midia[idCanal("Q1")] = "lanca";
    canal.midia[idCanal("Q2")] = { url: "http://canal/files/q2.jpg", erro: false };
    const db = bancoDeMentira();
    novaImportacao(db);
    const q1 = () => db.messages.find((m) => m.external_id === idCanal("Q1"))!;
    const religar = () => db.importacoes.set(IMP, { ...db.importacoes.get(IMP)!, status: "rodando" });

    for (const n of [1, 2]) {
      const r = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
      expect(r.status).toBe("erro");
      expect((q1().metadata as Linha).tentativas_midia).toBe(n);
      expect((q1().metadata as Linha).media_status).toBe("pendente");
      expect((q1().metadata as Linha).historico_importado).toBe("true");
      expect(db.importacoes.get(IMP)!.cursor).toMatchObject({ indiceConversa: 0, offsetMensagens: 0 });
      religar();
    }
    const r3 = await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(r3.status).toBe("concluida");
    expect((q1().metadata as Linha).media_status).toBe("indisponivel");
    expect(q1().media_url).toBeNull();
    // a mídia seguinte foi alcançada
    expect(db.messages.find((m) => m.external_id === idCanal("Q2"))!.media_url).toBe("http://canal/files/q2.jpg");
    expect(db.importacoes.get(IMP)).toMatchObject({ midias_indisponiveis: 1, midias_baixadas: 1 });
  });

  it("falha uma vez e depois funciona: termina solicitada e emitida", async () => {
    canal.mensagens = [imagem("R1", agora - 86_400)];
    canal.midia[idCanal("R1")] = "lanca";
    const db = bancoDeMentira();
    novaImportacao(db);
    expect((await rodarUmaRodada(db.admin as never, IMP, SEM_TETO)).status).toBe("erro");
    canal.midia[idCanal("R1")] = { url: "http://canal/files/r1.jpg", erro: false };
    db.importacoes.set(IMP, { ...db.importacoes.get(IMP)!, status: "rodando" });
    expect((await rodarUmaRodada(db.admin as never, IMP, SEM_TETO)).status).toBe("concluida");
    expect(db.messages[0]!.metadata).toMatchObject({ media_status: "solicitada", historico_importado: "true" });
    expect(emits(db)).toHaveLength(1);
  });

  it("teto de chamadas no meio das mídias: cursor não passa da página; a refeita resolve só as pendentes", async () => {
    canal.mensagens = [imagem("P1", agora - 90_000), imagem("P2", agora - 80_000), imagem("P3", agora - 70_000)];
    for (const n of ["P1", "P2", "P3"]) canal.midia[idCanal(n)] = { url: `http://canal/files/${n}.jpg`, erro: false };
    const db = bancoDeMentira();
    novaImportacao(db);
    // 1 (conversas) + 1 (mensagens) + 1 mídia = 3 chamadas
    const teto = { conversas: 10, mensagens: 300, chamadas: 3 };
    const r1 = await rodarUmaRodada(db.admin as never, IMP, teto);
    expect(r1.status).toBe("rodando");
    expect(canal.baixadas).toHaveLength(1);
    expect(db.importacoes.get(IMP)!.cursor).toMatchObject({ indiceConversa: 0, offsetMensagens: 0 });
    expect(db.messages).toHaveLength(3);
    expect(db.importacoes.get(IMP)).toMatchObject({ midias_baixadas: 1 });

    let ultima = r1;
    for (let i = 0; i < 6 && ultima.status === "rodando"; i++) {
      ultima = await rodarUmaRodada(db.admin as never, IMP, teto);
    }
    expect(ultima.status).toBe("concluida");
    // cada mídia foi pedida UMA vez e cada persistência emitida UMA vez
    expect(canal.baixadas.map((b) => b[2]).sort()).toEqual(["P1", "P2", "P3"].map(idCanal));
    expect(emits(db)).toHaveLength(3);
    expect(db.messages).toHaveLength(3);
    expect(db.importacoes.get(IMP)).toMatchObject({ midias_baixadas: 3, midias_indisponiveis: 0, status: "concluida" });
  });

  it("só emite persist_requested: nenhum outro evento, nem derivação", async () => {
    canal.mensagens = [imagem("I4", agora - 86_400)];
    canal.midia[idCanal("I4")] = { url: "http://canal/files/i4.jpg", erro: false };
    const db = bancoDeMentira();
    novaImportacao(db);
    await rodarUmaRodada(db.admin as never, IMP, SEM_TETO);
    expect(new Set(db.rpcs.map((r) => r.fn))).toEqual(
      new Set(["fn_upsert_wa_contact", "fn_upsert_wa_conversation_importada", "emit_event"]),
    );
    expect(emits(db).map((e) => e.args.p_event_type)).toEqual(["media.persist_requested"]);
    expect(auditEspiao).not.toHaveBeenCalled();
  });
});
