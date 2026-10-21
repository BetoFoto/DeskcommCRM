"use client";

import { useT } from "@/hooks/i18n/useT";

import { useState, useSyncExternalStore } from "react";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useNotificationPermission } from "@/hooks/notifications/useNotificationPermission";
import {
  ehMotivoDoAparelho,
  encerrarPushDesteAparelho,
  pushNaoEntrega,
  syncPushSubscription,
  type ResultadoDaInscricao,
} from "@/lib/notifications/push_client";
import {
  NOTIFY_UI_CATEGORIES,
  assinarPrefs,
  getPrefsSnapshot,
  getPrefsSnapshotDoServidor,
  gravarCanal,
  pushEfetivo,
  type NotifyCategory,
  type NotifyChannelPref,
} from "@/lib/notifications/prefs";

const LABELS: Record<NotifyCategory, string> = {
  message: "Nova mensagem",
  lead_assigned: "Lead atribuído a você",
  lead_won: "Lead ganho",
  lead_lost: "Lead perdido",
  mention: "Você foi mencionado",
  call_inbound: "Ligação recebida",
};

export function NotificationPrefsClient() {
  const t = useT();
  const { permission, request } = useNotificationPermission();
  const prefs = useSyncExternalStore(assinarPrefs, getPrefsSnapshot, getPrefsSnapshotDoServidor);
  const denied = permission === "denied";
  const unsupported = permission === "unsupported";
  // A inscrição que não pegou (issues #3116 e #3164). `null` = nada a dizer.
  const [recusaDoPush, setRecusaDoPush] = useState<ResultadoDaInscricao | null>(null);

  /**
   * A FRASE, POR CAUSA (issue #3164).
   *
   * O `ignorado` cobria caminhos que NÃO se parecem, e um texto só para todos
   * mentiria em pelo menos um: "o servidor recusou" para quem está sem internet,
   * "alguma coisa falhou" para quem precisa saber se o problema é do navegador,
   * do aparelho ou da instalação. São quatro causas de aparelho, e cada uma tem
   * a sua frase — a pessoa só consegue resolver sabendo qual é.
   */
  function textoDaInscricao(r: ResultadoDaInscricao): string | null {
    if (r.situacao === "sem_rede")
      return t(
        "Não consegui falar com o servidor, então este aparelho não foi inscrito: confira a internet e ligue o Push de novo.",
      );
    if (r.situacao === "recusado")
      return t(
        "O servidor recusou a inscrição deste aparelho, então os avisos não vão chegar: o interruptor de Push voltou a ficar desligado.",
      );
    if (r.situacao !== "ignorado" || !ehMotivoDoAparelho(r.motivo)) return null;
    switch (r.motivo) {
      case "sem_service_worker":
        return t(
          "Este navegador não registrou o service worker dos avisos, então este aparelho não recebe Push: o interruptor voltou a ficar desligado.",
        );
      case "sem_vapid":
        return t(
          "Esta instalação não tem o par de chaves do Push (VAPID), então nenhum aparelho recebe aviso com o site fechado: o interruptor voltou a ficar desligado.",
        );
      case "inscricao_incompleta":
        return t(
          "O navegador não devolveu os dados completos da inscrição de Push deste aparelho, então os avisos não vão chegar: o interruptor voltou a ficar desligado.",
        );
      case "navegador_recusou":
        return t(
          "O navegador recusou criar a inscrição de Push deste aparelho, então os avisos não vão chegar: o interruptor voltou a ficar desligado.",
        );
    }
  }

  async function onToggle(category: NotifyCategory, channel: NotifyChannelPref, on: boolean) {
    if (channel === "push" && on) {
      if (permission !== "granted") {
        const next = await request();
        if (next !== "granted") return;
      }
    }
    gravarCanal(category, channel, on);
    // O push de mensagem é o interruptor do aparelho (`pushEfetivo`).
    if (category === "message" && channel === "push") {
      if (!on) {
        setRecusaDoPush(null);
        await encerrarPushDesteAparelho();
        return;
      }
      const resultado = await syncPushSubscription();
      if (pushNaoEntrega(resultado)) {
        // ⚠️ O INTERRUPTOR VOLTA A DESLIGAR, e é o estado honesto: nada foi
        // inscrito, então nenhum aviso chegaria com o site fechado. Deixá-lo
        // ligado era a mentira que as issues #3116 e #3164 medem. Quem decide é
        // `pushNaoEntrega`, pela CAUSA: causa de aparelho/instalação desliga;
        // causa que é só preferência da pessoa NÃO — ali o interruptor está
        // dizendo uma escolha dela, e desfazê-la sozinha seria tirá-la da mão
        // de quem clicou.
        gravarCanal("message", "push", false);
        setRecusaDoPush(resultado ?? null);
      } else {
        setRecusaDoPush(null);
      }
    }
  }

  return (
    <Card className="p-0">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className="px-4 py-3 text-left font-medium">{t("Categoria")}</th>
            <th className="px-4 py-3 text-center font-medium">Email</th>
            <th className="px-4 py-3 text-center font-medium">In-app</th>
            <th className="px-4 py-3 text-center font-medium">Push</th>
          </tr>
        </thead>
        <tbody>
          {NOTIFY_UI_CATEGORIES.map((cat) => (
            <tr key={cat} className="border-b last:border-0">
              <td className="px-4 py-3">
                {t(LABELS[cat])}
                {cat === "message" && denied ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      "O navegador bloqueou as notificações. Libere-as nas configurações do site e recarregue.",
                    )}
                  </p>
                ) : null}
                {cat === "message" ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("Desligar o push de mensagem desliga todos os avisos deste aparelho fora do app.")}
                  </p>
                ) : null}
                {cat === "message" && recusaDoPush !== null ? (
                  <div
                    className="mt-1 text-xs text-destructive"
                    data-testid="push-recusado"
                    data-motivo={
                      recusaDoPush.situacao === "ignorado"
                        ? recusaDoPush.motivo
                        : recusaDoPush.situacao
                    }
                    role="alert"
                  >
                    <p>{textoDaInscricao(recusaDoPush)}</p>
                    {recusaDoPush.situacao === "recusado" && recusaDoPush.motivo ? (
                      <p className="mt-0.5">{recusaDoPush.motivo}</p>
                    ) : null}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-center">
                <Switch checked={false} disabled aria-label={`${t(LABELS[cat])} via email`} />
              </td>
              <td className="px-4 py-3 text-center">
                <Switch
                  checked={prefs[cat].in_app}
                  onCheckedChange={(on) => void onToggle(cat, "in_app", on)}
                  aria-label={`${t(LABELS[cat])} via in_app`}
                />
              </td>
              <td className="px-4 py-3 text-center">
                <Switch
                  checked={pushEfetivo(prefs, cat, "push")}
                  disabled={denied || unsupported || (cat !== "message" && !prefs.message.push)}
                  onCheckedChange={(on) => void onToggle(cat, "push", on)}
                  aria-label={`${t(LABELS[cat])} via push`}
                  data-testid={cat === "message" ? (prefs.message.push ? "alerts-toggle" : "alerts-enable") : undefined}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
