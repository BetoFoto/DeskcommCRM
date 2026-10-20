import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { vapidPronto, vapidPublica, vapidSubject } from "./vapid";
import type { PushPayload } from "./push_payload";
import { lerTelaBloqueada, redigirParaATelaBloqueada } from "./tela-bloqueada";

export type PushSubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * O FUNIL: todo push do produto sai daqui, e só daqui (vigiado por
 * `tests/unit/push-sai-so-pelo-funil.test.ts`). Lê a opção da empresa sobre o
 * que aparece com a tela bloqueada, redige (`./tela-bloqueada.ts`), envia, e
 * apaga as inscrições mortas (404/410) no banco.
 */
async function entregarPush(
  admin: Admin,
  organizationId: string,
  payload: PushPayload,
  rows: PushSubRow[],
): Promise<{ sent: number; gone: number }> {
  if (rows.length === 0) return { sent: 0, gone: 0 };

  const { modo, idioma } = await lerTelaBloqueada(admin, organizationId);
  const corpo = JSON.stringify(redigirParaATelaBloqueada(payload, modo, idioma));

  webpush.setVapidDetails(await vapidSubject(), vapidPublica()!, env.VAPID_PRIVATE_KEY.trim());

  let sent = 0;
  let gone = 0;
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          corpo,
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          gone += 1;
          await admin.from("push_subscriptions").delete().eq("id", row.id).eq("organization_id", organizationId);
          return;
        }
        logger.warn("web_push_send_failed", { status: status ?? 0 });
      }
    }),
  );

  return { sent, gone };
}

export async function enviarPushDaOrg(
  organizationId: string,
  payload: PushPayload,
  admin: Admin = createAdminClient(),
): Promise<{ sent: number; gone: number }> {
  if (!vapidPronto()) return { sent: 0, gone: 0 };
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("organization_id", organizationId);
  if (error) {
    logger.warn("push_subscriptions_list_failed", { detail: error.message });
    return { sent: 0, gone: 0 };
  }
  return entregarPush(admin, organizationId, payload, data ?? []);
}

export async function enviarPushAoUsuario(
  organizationId: string,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; gone: number }> {
  if (!vapidPronto()) return { sent: 0, gone: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (error) {
    logger.warn("push_subscriptions_user_list_failed", { detail: error.message });
    return { sent: 0, gone: 0 };
  }
  return entregarPush(admin, organizationId, payload, data ?? []);
}

/**
 * Push de mensagem recebida: só às inscrições de quem PODE VER a conversa.
 *
 * Quem decide é `fn_can_view_conversation` (a RLS de `conversations`), avaliada
 * para cada inscrito por `fn_push_inscricoes_que_veem_a_conversa` — a regra não
 * é repetida aqui. Falha na leitura não envia a ninguém.
 *
 * `soUsuarios` é a lista de quem DEVE ser avisado (`./destinatarios-da-mensagem.ts`);
 * ela só estreita o conjunto, nunca alarga além de quem pode ver.
 */
export async function enviarPushAQuemVeAConversa(
  organizationId: string,
  conversationId: string,
  payload: PushPayload,
  soUsuarios?: ReadonlyArray<string>,
  admin: Admin = createAdminClient(),
): Promise<{ sent: number; gone: number }> {
  if (!vapidPronto() || soUsuarios?.length === 0) return { sent: 0, gone: 0 };
  const { data, error } = await admin.rpc("fn_push_inscricoes_que_veem_a_conversa", {
    p_org: organizationId,
    p_conversation: conversationId,
  });
  if (error) {
    logger.warn("push_subscriptions_visible_list_failed", { detail: error.message });
    return { sent: 0, gone: 0 };
  }
  // O admin client não é tipado pelo schema: a forma vem de `lib/database.types.ts`.
  const visiveis: Array<PushSubRow & { user_id: string }> = data ?? [];
  const linhas = visiveis.filter((l) => !soUsuarios || soUsuarios.includes(l.user_id));
  return entregarPush(admin, organizationId, payload, linhas);
}
