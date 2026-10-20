/**
 * Leitura do acervo no cliente do WAHA (importador de histórico, #999).
 * Fixture anonimizada no formato medido no WAHA 2026.7.2 (NOWEB).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WahaClient } from "@/lib/waha/client";

const fx = JSON.parse(readFileSync("lib/waha/__fixtures__/acervo-noweb-2026.7.2.json", "utf8")) as {
  chats: unknown[];
  messages: Record<string, Array<Record<string, unknown>>>;
  midia: { disponivel: unknown; expirada: unknown };
};

let server: Server;
let base = "";
let urls: string[] = [];
let headers: Array<string | string[] | undefined> = [];
let forcarStatus: number | null = null;
/** Corpo 200 que NÃO é lista: o canal respondeu, mas não o que o paginador espera. */
let corpoForcado: string | null = null;
let midia: unknown = fx.midia.disponivel;
let mensagensExtras: unknown[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    urls.push(req.url ?? "");
    headers.push(req.headers["x-api-key"]);
    res.setHeader("content-type", "application/json");
    if (forcarStatus) {
      res.statusCode = forcarStatus;
      return res.end("{}");
    }
    if (corpoForcado !== null) return res.end(corpoForcado);
    const u = new URL(req.url ?? "", "http://x");
    if (u.pathname === "/api/s1/chats") return res.end(JSON.stringify(fx.chats));
    const m = u.pathname.match(/^\/api\/s1\/chats\/([^/]+)\/messages$/);
    if (m) return res.end(JSON.stringify([...(fx.messages[decodeURIComponent(m[1] ?? "")] ?? []), ...mensagensExtras]));
    if (/^\/api\/s1\/chats\/[^/]+\/messages\/[^/]+$/.test(u.pathname)) return res.end(JSON.stringify(midia));
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  urls = [];
  headers = [];
  forcarStatus = null;
  corpoForcado = null;
  midia = fx.midia.disponivel;
  mensagensExtras = [];
});

const novo = () => new WahaClient(base, "chave");

describe("listarConversas", () => {
  it("pagina por offset, lê id string e id._serialized, e exclui grupo e status", async () => {
    const r = await novo().listarConversas("s1", { limit: 50, offset: 100 });
    // Ordem ESTÁVEL por id: o cursor da importação é uma posição nesta lista, e a ordem
    // padrão (por última mensagem) muda a cada mensagem nova, pulando conversa.
    expect(urls[0]).toBe("/api/s1/chats?limit=50&offset=100&sortBy=id&sortOrder=asc");
    expect(headers[0]).toBe("chave");
    expect(r).toEqual([
      { chatId: "5511900000001@s.whatsapp.net", ultimaEm: 1760000300 },
      { chatId: "111111111111111@lid", ultimaEm: 1760000500 },
    ]);
  });

  it("status diferente de 200 vira waha_chats_<status>", async () => {
    forcarStatus = 502;
    await expect(novo().listarConversas("s1", { limit: 1, offset: 0 })).rejects.toThrow("waha_chats_502");
  });

  it.each(["{}", '{"error":"x"}', "null", "lixo"])(
    "200 que não é lista vira waha_chats_invalido (%s), não lista vazia",
    async (corpo) => {
      corpoForcado = corpo;
      await expect(novo().listarConversas("s1", { limit: 1, offset: 0 })).rejects.toThrow("waha_chats_invalido");
    },
  );
});

describe("paginaDeConversas", () => {
  it("diz quantas leu do canal e a posição de cada 1:1, mesmo com grupo e status no meio", async () => {
    const r = await novo().paginaDeConversas("s1", { limit: 4, offset: 10 });
    expect(r.lidas).toBe(4);
    expect(r.conversas).toEqual([
      { chatId: "5511900000001@s.whatsapp.net", ultimaEm: 1760000300, posicao: 10 },
      { chatId: "111111111111111@lid", ultimaEm: 1760000500, posicao: 11 },
    ]);
  });

  it("página só de grupo: nenhuma conversa, mas lidas > 0 (não é o fim)", async () => {
    corpoForcado = JSON.stringify([{ id: "120363000000000001@g.us" }, { id: "status@broadcast" }]);
    const r = await novo().paginaDeConversas("s1", { limit: 2, offset: 0 });
    expect(r).toEqual({ conversas: [], lidas: 2 });
  });
});

describe("listarMensagens", () => {
  it("pede sem mídia, do mais antigo ao mais novo, filtrando por data no servidor", async () => {
    const r = await novo().listarMensagens("s1", "5511900000001@s.whatsapp.net", { limit: 20, offset: 0, desde: 0 });
    const u = new URL(urls[0] ?? "", "http://x");
    expect(u.pathname).toBe("/api/s1/chats/5511900000001%40s.whatsapp.net/messages");
    expect(u.searchParams.get("downloadMedia")).toBe("false");
    expect(u.searchParams.get("sortBy")).toBe("timestamp");
    expect(u.searchParams.get("sortOrder")).toBe("asc");
    expect(u.searchParams.get("filter.timestamp.gte")).toBe("0");
    expect(u.searchParams.get("limit")).toBe("20");
    expect(r.map((m) => m.id)).toEqual([
      "false_222222222222222@lid_AAA001",
      "true_222222222222222@lid_AAA002",
      "false_5511900000001@s.whatsapp.net_AAA003",
      "false_222222222222222@lid_AAA004",
    ]);
    expect(r[1]?.fromMe).toBe(true);
    expect(r[2]?.hasMedia).toBe(true);
  });

  it("filtra timestamp >= desde também localmente", async () => {
    const r = await novo().listarMensagens("s1", "5511900000001@s.whatsapp.net", {
      limit: 20,
      offset: 0,
      desde: 1760000300,
    });
    expect(r.map((m) => m.timestamp)).toEqual([1760000300, 1760000400]);
  });

  it("preserva remoteJidAlt do chat @lid", async () => {
    const r = await novo().listarMensagens("s1", "111111111111111@lid", { limit: 20, offset: 0, desde: 0 });
    expect(r).toHaveLength(2);
    expect(r[0]?._data?.key?.remoteJidAlt).toBe("5511900000002@s.whatsapp.net");
  });

  it("descarta item que o schema recusa sem derrubar a lista", async () => {
    mensagensExtras = [{ id: "x", timestamp: 1760000999, body: 42 }, "lixo", null];
    const r = await novo().listarMensagens("s1", "111111111111111@lid", { limit: 20, offset: 0, desde: 0 });
    expect(r).toHaveLength(2);
  });

  it("status diferente de 200 vira waha_messages_<status>", async () => {
    forcarStatus = 500;
    await expect(novo().listarMensagens("s1", "a@lid", { limit: 1, offset: 0, desde: 0 })).rejects.toThrow(
      "waha_messages_500",
    );
  });

  it.each(["{}", '{"error":"x"}', "null", "lixo"])(
    "200 que não é lista vira waha_messages_invalido (%s), não fim da conversa",
    async (corpo) => {
      corpoForcado = corpo;
      await expect(novo().listarMensagens("s1", "a@lid", { limit: 1, offset: 0, desde: 0 })).rejects.toThrow(
        "waha_messages_invalido",
      );
    },
  );
});

describe("baixarMidiaDaMensagem", () => {
  it("devolve a url quando o arquivo está disponível", async () => {
    const r = await novo().baixarMidiaDaMensagem(
      "s1",
      "5511900000001@s.whatsapp.net",
      "false_5511900000001@s.whatsapp.net_AAA003",
    );
    expect(urls[0]).toContain("downloadMedia=true");
    expect(r).toEqual({ url: "http://waha.test/api/files/AAA003.jpeg", erro: false });
  });

  it("devolve { url: null, erro: true } quando vem media.error", async () => {
    midia = fx.midia.expirada;
    const r = await novo().baixarMidiaDaMensagem(
      "s1",
      "5511900000001@s.whatsapp.net",
      "false_222222222222222@lid_AAA004",
    );
    expect(r).toEqual({ url: null, erro: true });
  });

  it("status diferente de 200 vira waha_media_<status>", async () => {
    forcarStatus = 404;
    await expect(novo().baixarMidiaDaMensagem("s1", "a@lid", "m")).rejects.toThrow("waha_media_404");
  });
});
