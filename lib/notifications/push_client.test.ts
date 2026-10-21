/**
 * `encerrarPushDesteAparelho` — desligar os alertas e sair encerram o push do
 * aparelho: o servidor esquece a inscrição (DELETE, que precisa da sessão) e o
 * navegador cancela a dele. Nunca lança: a saída não pode depender da rede.
 *
 * Roda com: npx vitest run lib/notifications/push_client.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encerrarPushDesteAparelho, syncPushSubscription } from "./push_client";

const ordem: string[] = [];
const fetchFalso = vi.fn(async (..._args: unknown[]) => {
  ordem.push("delete");
  return new Response(null, { status: 200 });
});
const unsubscribe = vi.fn(async () => {
  ordem.push("unsubscribe");
  return true;
});
const register = vi.fn();

function comServiceWorker(sub: { endpoint: string; unsubscribe: typeof unsubscribe } | null) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register,
      getRegistration: vi.fn(async () => ({ pushManager: { getSubscription: async () => sub } })),
    },
  });
}

beforeEach(() => {
  ordem.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("encerrarPushDesteAparelho", () => {
  it("manda o DELETE com o endpoint ANTES de cancelar a inscrição no navegador", async () => {
    comServiceWorker({ endpoint: "https://push/1", unsubscribe });
    await encerrarPushDesteAparelho();
    expect(ordem).toEqual(["delete", "unsubscribe"]);
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/notifications/push");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBe(JSON.stringify({ endpoint: "https://push/1" }));
  });

  it("DELETE falhando não impede o cancelamento, e a promessa resolve", async () => {
    fetchFalso.mockRejectedValueOnce(new Error("rede fora"));
    comServiceWorker({ endpoint: "https://push/1", unsubscribe });
    await expect(encerrarPushDesteAparelho()).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("cancelamento falhando também não lança", async () => {
    unsubscribe.mockRejectedValueOnce(new Error("x"));
    comServiceWorker({ endpoint: "https://push/1", unsubscribe });
    await expect(encerrarPushDesteAparelho()).resolves.toBeUndefined();
  });

  it("sem inscrição: nenhum pedido ao servidor", async () => {
    comServiceWorker(null);
    await encerrarPushDesteAparelho();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("sem service worker no navegador: nenhum pedido e nenhum lançamento", async () => {
    await expect(encerrarPushDesteAparelho()).resolves.toBeUndefined();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("não registra service worker para sair", async () => {
    comServiceWorker({ endpoint: "https://push/1", unsubscribe });
    await encerrarPushDesteAparelho();
    expect(register).not.toHaveBeenCalled();
  });
});

describe("syncPushSubscription", () => {
  const subscribe = vi.fn(async () => ({
    toJSON: () => ({ endpoint: "https://push/1", keys: { p256dh: "p", auth: "a" } }),
  }));

  beforeEach(() => {
    vi.stubGlobal("Notification", { permission: "granted" });
    fetchFalso.mockImplementation(async () =>
      new Response(JSON.stringify({ data: { enabled: true, public_key: "AAAA" } }), { status: 200 }),
    );
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: vi.fn(async () => ({ pushManager: { getSubscription: async () => null, subscribe } })) },
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    fetchFalso.mockReset();
  });

  // `alerts.enabled` é espelho: a permissão concedida para outra linha da tela o
  // regrava como "1" sem tocar no interruptor de mensagem. A fonte é a preferência.
  it("push de mensagem desligado: não inscreve nem manda PUT, mesmo com o espelho em 1", async () => {
    window.localStorage.setItem("notify.prefs.v1", JSON.stringify({ message: { in_app: true, push: false } }));
    window.localStorage.setItem("alerts.enabled", "1");
    await syncPushSubscription();
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchFalso.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(false);
  });

  it("push de mensagem ligado: inscreve e manda PUT (controle positivo)", async () => {
    await syncPushSubscription();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(fetchFalso.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(true);
  });

  /**
   * ISSUE #3116 — a recusa 422 da rota não pode ser engolida.
   *
   * O PUT responde `{ error: { code: "validation_failed" } }` com 422 (o
   * serviço de push fora da lista de `servicos-de-push.ts`). No código ANTIGO
   * a função não olhava `res.ok` e devolvia `void`: a tela ligava o interruptor
   * e nada avisava. Este caso é o que fica VERMELHO se o tratamento de
   * `!res.ok` sair — a sabotagem do PR exercita exatamente isto.
   */
  it("PUT recusado (422): a função REPORTA a recusa com a frase do servidor", async () => {
    fetchFalso.mockImplementation(async (...args: unknown[]) => {
      const init = args[1] as RequestInit | undefined;
      return init?.method === "PUT"
        ? new Response(JSON.stringify({ error: { code: "validation_failed", message: "Campos inválidos." } }), {
            status: 422,
          })
        : new Response(JSON.stringify({ data: { enabled: true, public_key: "AAAA" } }), { status: 200 });
    });

    const resultado = await syncPushSubscription();

    expect(resultado.situacao).toBe("recusado");
    expect(resultado.motivo).toBe("Campos inválidos.");
  });

  // CONTROLE: o PUT aceito (200) segue igual ao que era — nada de recusa.
  it("PUT aceito (200): reporta ativo, sem recusa (controle)", async () => {
    const resultado = await syncPushSubscription();

    expect(resultado.situacao).toBe("ativo");
    expect(resultado.motivo).toBe("");
  });
});
