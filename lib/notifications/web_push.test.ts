/**
 * `enviarPushAQuemVeAConversa` — push de `message.received`. Só sai para as
 * inscrições que o banco devolveu como capazes de ver a conversa; a lista de
 * quem deve ser avisado (responsável + admins) só estreita esse conjunto, e a
 * faxina 404/410 continua valendo.
 *
 * Roda com: npx vitest run lib/notifications/web_push.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotification, deletados } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  deletados: [] as Array<[string, string]>,
}));

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));
vi.mock("./vapid", () => ({
  vapidPronto: () => true,
  vapidPublica: () => "pub",
  vapidSubject: async () => "mailto:x@example.com",
}));
vi.mock("@/lib/env", () => ({ env: { VAPID_PRIVATE_KEY: "priv" } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";

import { enviarPushAoUsuario, enviarPushAQuemVeAConversa, enviarPushDaOrg } from "./web_push";

type Linha = { id: string; user_id: string; endpoint: string };

/**
 * O admin client de mentira: a RPC de quem vê a conversa, a lista de
 * inscrições (`push_subscriptions`, com os filtros registrados), a faxina e a
 * leitura da opção da empresa em `organizations`.
 */
function adminFalso(
  linhas: Linha[],
  erro: { message: string } | null = null,
  org: { data: unknown; error: { message: string } | null } = { data: { settings: {}, locale: "pt-BR" }, error: null },
) {
  const chamadas: Array<[string, unknown]> = [];
  const tabelasLidas: string[] = [];
  const filtrosDaLista: Array<[string, string]> = [];
  const comChaves = () => linhas.map((l) => ({ ...l, p256dh: "k", auth: "a" }));
  const admin = {
    rpc: async (fn: string, args: unknown) => {
      chamadas.push([fn, args]);
      return erro ? { data: null, error: erro } : { data: comChaves(), error: null };
    },
    from: (tabela: string) => {
      tabelasLidas.push(tabela);
      if (tabela === "organizations") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => org };
        return q;
      }
      const lista = {
        eq: (c: string, v: string) => {
          filtrosDaLista.push([c, v]);
          return lista;
        },
        then: (resolve: (r: unknown) => unknown) =>
          resolve(erro ? { data: null, error: erro } : { data: comChaves(), error: null }),
      };
      return {
        select: () => lista,
        delete: () => {
          const del = {
            eq: (c: string, v: string) => {
              deletados.push([c, v]);
              return del;
            },
            then: (resolve: (r: unknown) => unknown) => resolve({ error: null }),
          };
          return del;
        },
      };
    },
  };
  return { admin, chamadas, tabelasLidas, filtrosDaLista };
}

const payload = { title: "t", body: "b" } as never;

beforeEach(() => {
  sendNotification.mockReset();
  deletados.length = 0;
});

describe("enviarPushAQuemVeAConversa", () => {
  it("pergunta ao banco quem vê a conversa DO EVENTO e envia só a essas inscrições", async () => {
    sendNotification.mockResolvedValue(undefined);
    const { admin, chamadas } = adminFalso([
      { id: "s1", user_id: "u-ana", endpoint: "https://push/1" },
      { id: "s2", user_id: "u-admin", endpoint: "https://push/2" },
    ]);
    const r = await enviarPushAQuemVeAConversa("org-1", "conv-1", payload, undefined, admin as never);
    expect(r).toEqual({ sent: 2, gone: 0 });
    expect(chamadas).toEqual([
      ["fn_push_inscricoes_que_veem_a_conversa", { p_org: "org-1", p_conversation: "conv-1" }],
    ]);
  });

  it("a lista de quem deve ser avisado só estreita: quem não pode ver não entra por ela", async () => {
    sendNotification.mockResolvedValue(undefined);
    const { admin } = adminFalso([{ id: "s1", user_id: "u-ana", endpoint: "https://push/ana" }]);
    const r = await enviarPushAQuemVeAConversa("org-1", "conv-1", payload, ["u-ana", "u-bruno"], admin as never);
    expect(r).toEqual({ sent: 1, gone: 0 });
    expect(sendNotification.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint)).toEqual([
      "https://push/ana",
    ]);
  });

  it("quem pode ver mas não está na lista decidida não recebe", async () => {
    sendNotification.mockResolvedValue(undefined);
    const { admin } = adminFalso([
      { id: "s1", user_id: "u-ana", endpoint: "https://push/ana" },
      { id: "s2", user_id: "u-carla", endpoint: "https://push/carla" },
    ]);
    await enviarPushAQuemVeAConversa("org-1", "conv-1", payload, ["u-ana"], admin as never);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("inscrição morta (410) é apagada, como no envio da org", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 410 }).mockResolvedValueOnce(undefined);
    const { admin } = adminFalso([
      { id: "morta", user_id: "u-ana", endpoint: "https://push/1" },
      { id: "viva", user_id: "u-ana", endpoint: "https://push/2" },
    ]);
    const r = await enviarPushAQuemVeAConversa("org-1", "conv-1", payload, undefined, admin as never);
    expect(r).toEqual({ sent: 1, gone: 1 });
    expect(deletados).toEqual([
      ["id", "morta"],
      ["organization_id", "org-1"],
    ]);
  });

  it("lista decidida vazia não consulta nem envia nada", async () => {
    const { admin, chamadas } = adminFalso([{ id: "s1", user_id: "u-ana", endpoint: "https://push/1" }]);
    const r = await enviarPushAQuemVeAConversa("org-1", "conv-1", payload, [], admin as never);
    expect(r).toEqual({ sent: 0, gone: 0 });
    expect(chamadas).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("falha ao perguntar quem vê → ninguém recebe", async () => {
    const { admin } = adminFalso([], { message: "banco fora" });
    const r = await enviarPushAQuemVeAConversa("org-1", "conv-1", payload, undefined, admin as never);
    expect(r).toEqual({ sent: 0, gone: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

/** O que de fato chegou ao serviço de push (o 2º argumento de `sendNotification`). */
function enviado(i = 0): Record<string, unknown> {
  return JSON.parse(sendNotification.mock.calls[i]![1] as string) as Record<string, unknown>;
}

const doCliente = {
  title: "Ana",
  body: "texto do cliente",
  icon: "https://avatar",
  corpoSemPrevia: "Nova mensagem",
  tag: "msg:c1",
  href: "/app/inbox?id=c1",
};

const comOpcao = (valor: string) => ({
  data: { settings: { notificacoes: { conteudo_na_tela_bloqueada: valor } }, locale: "pt-BR" },
  error: null,
});

const entradas = [
  [
    "enviarPushDaOrg",
    (admin: unknown) => enviarPushDaOrg("org-1", doCliente, admin as never),
  ],
  [
    "enviarPushAoUsuario",
    (admin: unknown) => {
      vi.mocked(createAdminClient).mockReturnValue(admin as never);
      return enviarPushAoUsuario("org-1", "u-ana", doCliente);
    },
  ],
  [
    "enviarPushAQuemVeAConversa",
    (admin: unknown) => enviarPushAQuemVeAConversa("org-1", "conv-1", doCliente, undefined, admin as never),
  ],
] as const;

describe.each(entradas)("o funil da tela bloqueada — %s", (_nome, enviar) => {
  it("modo oculto: sem corpo, sem ícone, título neutro, e o corpo sem prévia nunca sai", async () => {
    sendNotification.mockResolvedValue(undefined);
    const { admin } = adminFalso([{ id: "s1", user_id: "u-ana", endpoint: "https://push/1" }], null, comOpcao("oculto"));
    await enviar(admin);
    const saida = enviado();
    expect(saida.body).toBe("");
    expect(saida.title).toBe("Novo aviso");
    expect(saida).not.toHaveProperty("icon");
    expect(saida).not.toHaveProperty("corpoSemPrevia");
    expect(saida).toMatchObject({ tag: "msg:c1", href: "/app/inbox?id=c1" });
  });

  it("modo nome: o corpo é o declarado sem prévia e o ícone fica", async () => {
    sendNotification.mockResolvedValue(undefined);
    const { admin } = adminFalso([{ id: "s1", user_id: "u-ana", endpoint: "https://push/1" }], null, comOpcao("nome"));
    await enviar(admin);
    expect(enviado()).toStrictEqual({
      title: "Ana",
      body: "Nova mensagem",
      icon: "https://avatar",
      tag: "msg:c1",
      href: "/app/inbox?id=c1",
    });
  });

  it("leitura da opção falha → sai no modo oculto", async () => {
    sendNotification.mockResolvedValue(undefined);
    const { admin } = adminFalso([{ id: "s1", user_id: "u-ana", endpoint: "https://push/1" }], null, {
      data: null,
      error: { message: "fora" },
    });
    await enviar(admin);
    expect(enviado()).toMatchObject({ title: "Novo aviso", body: "" });
  });

  it("sem inscrição nenhuma não lê a opção da empresa", async () => {
    const { admin, tabelasLidas } = adminFalso([]);
    expect(await enviar(admin)).toEqual({ sent: 0, gone: 0 });
    expect(tabelasLidas).not.toContain("organizations");
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("as listas de inscrição", () => {
  it("da organização filtra pela organização; do usuário, por organização e usuário", async () => {
    sendNotification.mockResolvedValue(undefined);
    const org = adminFalso([{ id: "s1", user_id: "u-ana", endpoint: "https://push/1" }]);
    await enviarPushDaOrg("org-1", doCliente, org.admin as never);
    expect(org.filtrosDaLista).toEqual([["organization_id", "org-1"]]);

    const usuario = adminFalso([{ id: "s1", user_id: "u-ana", endpoint: "https://push/1" }]);
    vi.mocked(createAdminClient).mockReturnValue(usuario.admin as never);
    await enviarPushAoUsuario("org-1", "u-ana", doCliente);
    expect(usuario.filtrosDaLista).toEqual([
      ["organization_id", "org-1"],
      ["user_id", "u-ana"],
    ]);
  });
});
