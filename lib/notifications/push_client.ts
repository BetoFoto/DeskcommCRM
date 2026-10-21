import { areAlertsEnabled, getPermission } from "./permission";
import { canalLigado } from "./prefs";
import { ensureNotifyServiceWorker } from "./service_worker";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function mesmosBytes(a: ArrayBuffer, b: Uint8Array): boolean {
  if (a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

/**
 * O QUE A INSCRIÇÃO DESTE APARELHO DEU (issue #3116).
 *
 * `syncPushSubscription` devolvia `void` e não olhava a resposta do PUT: a
 * recusa 422 da rota (`app/api/v1/notifications/push/route.ts:60`, o serviço de
 * push fora da lista de `servicos-de-push.ts`) era invisível. A tela ligava o
 * interruptor e nenhum aviso chegava — o pior silêncio, porque a pessoa acha
 * que está inscrita. Agora a função devolve o que aconteceu para quem a chama
 * poder desfazer o interruptor e dizer o porquê.
 *
 * - `ativo`    — o PUT foi aceito (2xx); a inscrição está de pé, como sempre.
 * - `recusado` — o servidor recusou (`!res.ok`): NÃO está inscrito, e `motivo`
 *                carrega a frase do servidor quando veio.
 * - `sem_rede` — o PUT nem chegou ao servidor (o `fetch` lançou): também NÃO
 *                está inscrito, mas dizer "o servidor recusou" a quem está sem
 *                internet daria a causa errada — por isso é outro estado.
 * - `ignorado` — o caminho nem chegou ao servidor (sem permissão, sem service
 *                worker, sem VAPID, sem canal ligado): os mesmos `return` de
 *                antes, sem recusa a reportar.
 */
export type SituacaoDaInscricao = "ativo" | "recusado" | "sem_rede" | "ignorado";

export interface ResultadoDaInscricao {
  situacao: SituacaoDaInscricao;
  /** Frase da recusa (`error.message` da rota), quando o servidor mandou uma. */
  motivo: string;
}

const IGNORADO: ResultadoDaInscricao = { situacao: "ignorado", motivo: "" };

/**
 * A frase que a rota JÁ devolve na recusa — `fail(...)` responde
 * `{ error: { code, message } }` (`lib/api/wrappers.ts`). Não inventa contrato
 * novo: lê o corpo e devolve "" quando não é JSON ou não traz mensagem.
 */
async function motivoDaRecusa(res: Response): Promise<string> {
  try {
    const corpo = (await res.json()) as { error?: { message?: unknown } };
    const mensagem = corpo?.error?.message;
    return typeof mensagem === "string" ? mensagem : "";
  } catch {
    return "";
  }
}

/**
 * Liga a inscrição Web Push depois da permissão. Sem VAPID no servidor, no-op.
 *
 * ⚠️ QUEM MAIS CHAMA — e por que eles ignoram o resultado: o interruptor da tela
 * (`app/app/settings/notifications/_client.tsx`) é o único que mostra a recusa.
 * `hooks/notifications/useNotificationPermission.ts` (ao conceder a permissão) e
 * `hooks/notifications/useInboundMessageAlerts.ts` (ao abrir o app) re-sincronizam
 * em segundo plano e seguem com `void`: não há interruptor para desfazer nem
 * recusa para mostrar naquele instante — a tela de Notificações é quem responde
 * por isso. Mudar a assinatura aqui não os quebra: eles descartam o retorno.
 */
export async function syncPushSubscription(): Promise<ResultadoDaInscricao> {
  if (typeof window === "undefined") return IGNORADO;
  // A preferência é a fonte: `alerts.enabled` é espelho que `request()` regrava.
  if (getPermission() !== "granted" || !areAlertsEnabled() || !canalLigado("message", "push"))
    return IGNORADO;
  const reg = await ensureNotifyServiceWorker();
  if (!reg?.pushManager) return IGNORADO;

  const cfg = await fetch("/api/v1/notifications/push").then((r) => r.json()).catch(() => null);
  const publicKey = cfg?.data?.public_key as string | undefined;
  if (!cfg?.data?.enabled || !publicKey) return IGNORADO;

  const chave = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Inscrição feita com OUTRA chave (o par do servidor mudou, por exemplo num
  // backup restaurado sem o .env) nunca mais recebe nada, e o navegador não
  // avisa: refaz com a chave atual. O PUT abaixo grava a nova. Navegador que
  // não informa a chave da inscrição fica como está: refazer a cada abertura
  // criaria uma inscrição nova toda vez.
  const chaveDaInscricao = sub?.options.applicationServerKey;
  if (sub && chaveDaInscricao && !mesmosBytes(chaveDaInscricao, chave)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chave as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return IGNORADO;

  let res: Response;
  try {
    res = await fetch("/api/v1/notifications/push", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });
  } catch {
    // Sem rede o PUT não chegou: o servidor não tem esta inscrição, e o
    // interruptor ligado seria mentira. Não é recusa: o servidor nem respondeu.
    return { situacao: "sem_rede", motivo: "" };
  }
  if (!res.ok) return { situacao: "recusado", motivo: await motivoDaRecusa(res) };
  return { situacao: "ativo", motivo: "" };
}

/**
 * Encerra o push DESTE aparelho: o servidor esquece a inscrição e o navegador
 * cancela a dele. Chamado ao desligar os alertas de mensagem e ao sair — antes
 * da action de saída, porque o DELETE precisa do cookie que ela apaga.
 *
 * Nunca lança, e as duas etapas são independentes: a saída não pode depender
 * da rede, e o cancelamento sozinho já faz o próximo envio limpar a linha no
 * servidor (404/410). Não registra service worker: sair não deve instalar nada.
 */
export async function encerrarPushDesteAparelho(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  let sub: PushSubscription | null = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    sub = (await reg?.pushManager?.getSubscription()) ?? null;
  } catch {
    return; // service worker inacessível: não há inscrição a encerrar
  }
  if (!sub) return;
  try {
    await fetch("/api/v1/notifications/push", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // sem rede: o cancelamento abaixo basta para a faxina do próximo envio
  }
  try {
    await sub.unsubscribe();
  } catch {
    // inscrição já inválida no navegador
  }
}
