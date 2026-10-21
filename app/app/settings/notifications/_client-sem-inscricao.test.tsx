/**
 * A TELA CONTRA O `syncPushSubscription` DE VERDADE — SEM DUBLÊ DA INSCRIÇÃO.
 *
 * ## Por que este arquivo existe, e o que ele acrescenta ao `_client.test.tsx`
 *
 * `_client.test.tsx` dubla o `syncPushSubscription` e mede a DECISÃO da tela:
 * qual frase, e se o interruptor volta a desligar. Isso é necessário e não é
 * suficiente — dublê não prova que o caminho real DEVOLVE aquele motivo. Quem
 * mede os caminhos de retorno é `lib/notifications/push_client.test.ts`.
 *
 * Aqui não há dublê: a inscrição é a de produção, e o que se dubla é só o que
 * compõe o CENÁRIO — a permissão do navegador (`Notification`), o
 * `navigator.serviceWorker` e o `fetch`. É a medida que o mantenedor pediu
 * (issue #3164): "quando o navegador não registra o service worker, ou quando a
 * instalação não tem o par VAPID, o interruptor de Push fica ligado e nenhuma
 * notificação chega, sem aviso".
 *
 * ## O defeito, medido no caminho inteiro
 *
 * `syncPushSubscription` devolvia `ignorado` sem motivo; `_client.tsx` só
 * revertia o interruptor em `recusado`/`sem_rede`. Sem service worker e sem
 * VAPID são exatamente dois caminhos que caem no `ignorado` — e nos dois o
 * interruptor ficava ligado, sem uma palavra na tela. Ver o caso por caminho.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationPrefsClient as NotificationPrefsClientType } from "./_client";

// O assunto aqui é a inscrição, não a tradução: `t()` devolve a chave, que é o
// texto em português — é o que a tela mostra para quem usa o produto em pt-BR.
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/notifications/useNotificationPermission", () => ({
  useNotificationPermission: () => ({
    permission: "granted",
    enabled: true,
    request: async () => "granted",
    setEnabled: () => {},
  }),
}));

const CHAVE = "notify.prefs.v1";

const fetchFalso = vi.fn(async (..._args: unknown[]) => new Response(null, { status: 200 }));

let NotificationPrefsClient: typeof NotificationPrefsClientType;

/** O service worker que o navegador devolve — `{}` é o navegador que não registrou. */
function comServiceWorker(registro: unknown): void {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn(async () => registro) },
  });
}

function inscricaoValida() {
  return {
    pushManager: {
      getSubscription: async () => null,
      subscribe: async () => ({
        toJSON: () => ({ endpoint: "https://push/1", keys: { p256dh: "p", auth: "a" } }),
      }),
    },
  };
}

beforeEach(async () => {
  window.localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("Notification", { permission: "granted" });
  // Padrão: a instalação SEM o par VAPID — o estado de todo primeiro deploy e o
  // que a issue nomeia. Quem precisa de outro responde o seu.
  fetchFalso.mockImplementation(
    async () => new Response(JSON.stringify({ data: { enabled: false } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchFalso);
  ({ NotificationPrefsClient } = await import("./_client"));
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
  fetchFalso.mockReset();
});

function montar(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(<NotificationPrefsClient />);
  });
  return container;
}

async function ligarOPush(container: HTMLElement): Promise<void> {
  const botao = container.querySelector('[aria-label="Nova mensagem via push"]') as HTMLElement;
  await act(async () => {
    botao.click();
  });
}

describe("sem inscrição, a tela diz a causa e o interruptor não fica ligado (issue #3164)", () => {
  it("navegador não registra o service worker: a frase é a do service worker e o interruptor volta a desligar", async () => {
    // `register` resolve SEM `pushManager`: é o navegador que não registra o
    // service worker — o primeiro caminho que a issue nomeia.
    comServiceWorker({});
    window.localStorage.setItem(CHAVE, JSON.stringify({ message: { in_app: true, push: false } }));
    const container = montar();

    await ligarOPush(container);

    const aviso = container.querySelector('[data-testid="push-recusado"]');
    expect(aviso, "o interruptor ficou ligado e a tela não disse nada").not.toBeNull();
    expect(aviso?.getAttribute("data-motivo")).toBe("sem_service_worker");
    expect(container.textContent).toContain(
      "Este navegador não registrou o service worker dos avisos, então este aparelho não recebe Push",
    );
    expect(container.innerHTML).toContain('data-testid="alerts-enable"');
    expect(container.innerHTML).not.toContain('data-testid="alerts-toggle"');
    // Nada foi inscrito: nenhum PUT saiu.
    expect(
      fetchFalso.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });

  it("instalação sem o par VAPID: a frase é a das chaves e o interruptor volta a desligar", async () => {
    comServiceWorker(inscricaoValida());
    window.localStorage.setItem(CHAVE, JSON.stringify({ message: { in_app: true, push: false } }));
    const container = montar();

    await ligarOPush(container);

    const aviso = container.querySelector('[data-testid="push-recusado"]');
    expect(aviso, "o interruptor ficou ligado e a tela não disse nada").not.toBeNull();
    expect(aviso?.getAttribute("data-motivo")).toBe("sem_vapid");
    expect(container.textContent).toContain(
      "Esta instalação não tem o par de chaves do Push (VAPID)",
    );
    // ⚠️ E não diz que o servidor recusou: não houve recusa nenhuma — a
    // inscrição nem foi tentada.
    expect(container.textContent).not.toContain("O servidor recusou a inscrição");
    expect(container.innerHTML).toContain('data-testid="alerts-enable"');
    expect(container.innerHTML).not.toContain('data-testid="alerts-toggle"');
  });

  it("CONTROLE (#3157): o PUT recusado pelo servidor segue com a frase dele e o interruptor desligado", async () => {
    comServiceWorker(inscricaoValida());
    fetchFalso.mockImplementation(async (...args: unknown[]) => {
      const init = args[1] as RequestInit | undefined;
      if (init?.method === "PUT")
        return new Response(JSON.stringify({ error: { message: "Campos inválidos." } }), {
          status: 422,
        });
      return new Response(JSON.stringify({ data: { enabled: true, public_key: "AAAA" } }), {
        status: 200,
      });
    });
    window.localStorage.setItem(CHAVE, JSON.stringify({ message: { in_app: true, push: false } }));
    const container = montar();

    await ligarOPush(container);

    const aviso = container.querySelector('[data-testid="push-recusado"]');
    expect(aviso?.getAttribute("data-motivo")).toBe("recusado");
    expect(container.textContent).toContain(
      "O servidor recusou a inscrição deste aparelho, então os avisos não vão chegar: o interruptor de Push voltou a ficar desligado.",
    );
    // A frase que a rota mandou também aparece — é o que a #3157 consertou.
    expect(container.textContent).toContain("Campos inválidos.");
    expect(container.innerHTML).toContain('data-testid="alerts-enable"');
  });

  it("CONTROLE (#3157): com a inscrição aceita, o interruptor fica ligado e nada é dito", async () => {
    comServiceWorker(inscricaoValida());
    fetchFalso.mockImplementation(async (...args: unknown[]) => {
      const init = args[1] as RequestInit | undefined;
      if (init?.method === "PUT") return new Response(null, { status: 200 });
      return new Response(JSON.stringify({ data: { enabled: true, public_key: "AAAA" } }), {
        status: 200,
      });
    });
    window.localStorage.setItem(CHAVE, JSON.stringify({ message: { in_app: true, push: false } }));
    const container = montar();

    await ligarOPush(container);

    expect(container.querySelector('[data-testid="push-recusado"]')).toBeNull();
    expect(container.innerHTML).toContain('data-testid="alerts-toggle"');
  });
});
