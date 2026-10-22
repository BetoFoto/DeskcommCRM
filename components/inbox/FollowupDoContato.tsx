"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { rotuloDoStatus, tomDoStatus } from "@/lib/followup/eventos-legiveis";

/**
 * O enrollment vivo, como `ENROLLMENT_LIST_COLUMNS` o devolve.
 */
type EnrollmentRow = {
  id: string;
  pointer_id: string;
  contact_id: string;
  status: string;
  started_at: string;
  updated_at: string;
};

/**
 * O ponteiro de um fluxo de follow-up publicado — a fonte do `pointer_id` que
 * o POST de inscrição cobra. O GET sem `surface` já exclui os roteiros de
 * atendimento (eles não se inscrevem pelo relógio).
 */
type FlowRow = {
  id: string;
  name: string;
  status: string;
  active_version_id: string | null;
};

interface Props {
  contactId: string;
  /** O modo readonly que o painel já expõe: falso esconde as ações de escrita. */
  podeEscrever: boolean;
}

/**
 * A lista, ou vazio. Se o formato vier diferente do contrato da rota, a seção
 * se oculta em vez de derrubar o painel inteiro — o mesmo princípio do estado
 * `erro` abaixo, e o que permite o painel ser montado por telas que só conhecem
 * o `crm-summary` (os dublês de um só `get` dos testes do painel).
 */
function listaDe<T>(valor: unknown): T[] {
  return Array.isArray(valor) ? (valor as T[]) : [];
}

/**
 * A PORTA DE FOLLOW-UP no painel da conversa (#3178).
 *
 * Qual fluxo está rodando neste contato, e as duas portas: iniciar um e parar o
 * que está de pé — sem sair do painel. Antes, isso só existia na fila de
 * follow-ups, longe da conversa onde a decisão é tomada.
 *
 * Lê o painel inteiro pelo MESMO canal (a rota, via `apiClient`), não por
 * react-query: assim o refetch da seção acompanha o do resumo, e os dublês de
 * um só `get` cobrem os dois. Como `RoteirosDoContato`, a seção se AUTO-OCULTA
 * quando não há enrollment vivo nem fluxo ativo — quem não usa o módulo não vê
 * a tela mudar.
 */
export function FollowupDoContato({ contactId, podeEscrever }: Props) {
  const t = useT();
  const [ativos, setAtivos] = useState<EnrollmentRow[] | null>(null);
  const [fluxos, setFluxos] = useState<FlowRow[] | null>(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [escolhido, setEscolhido] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    let cancelado = false;
    setErro(false);
    async function carregar() {
      try {
        // O GET de enrollments é da ORG; o recorte por contato é feito aqui —
        // a rota não tem filtro por contato.
        const [rEnroll, rFluxos] = await Promise.all([
          apiClient.get<{ data: EnrollmentRow[] }>("/api/v1/ai/followups/enrollments?status=active"),
          apiClient.get<{ data: FlowRow[] }>("/api/v1/ai/followup-flows"),
        ]);
        if (cancelado) return;
        setAtivos(listaDe(rEnroll.data));
        setFluxos(listaDe(rFluxos.data));
      } catch {
        if (cancelado) return;
        // Falha de leitura NÃO vira "nada rodando": os dados ficam nulos e a
        // seção some (não afirma nada sobre o negócio em cima de um erro).
        setErro(true);
        setAtivos(null);
        setFluxos(null);
      }
    }
    void carregar();
    return () => {
      cancelado = true;
    };
  }, [contactId, tentativa]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  const vivo = (ativos ?? []).find((e) => e.contact_id === contactId) ?? null;
  const fluxosAtivos = (fluxos ?? []).filter((f) => f.status === "active" && f.active_version_id);
  const nomeDoFluxo = (pointerId: string) => (fluxos ?? []).find((f) => f.id === pointerId)?.name ?? null;

  const iniciar = useCallback(async () => {
    if (!escolhido) return;
    setSalvando(true);
    try {
      await apiClient.post("/api/v1/ai/followups/enrollments", {
        pointer_id: escolhido,
        contact_id: contactId,
      });
      toast.success(t("Follow-up iniciado."));
      setEscolhido("");
      recarregar();
    } catch {
      toast.error(t("Não foi possível iniciar o follow-up."));
    } finally {
      setSalvando(false);
    }
  }, [escolhido, contactId, t, recarregar]);

  const parar = useCallback(async () => {
    if (!vivo) return;
    setSalvando(true);
    try {
      await apiClient.post(`/api/v1/ai/followups/enrollments/${vivo.id}/cancel`, {});
      toast.success(t("Follow-up encerrado."));
      recarregar();
    } catch {
      toast.error(t("Não foi possível encerrar o follow-up."));
    } finally {
      setSalvando(false);
    }
  }, [vivo, t, recarregar]);

  if (!contactId) return null;
  const carregando = !erro && (ativos === null || fluxos === null);
  if (carregando) return <Skeleton className="h-14 w-full" data-testid="inbox-followup-carregando" />;
  if (erro) return null;
  // Nada vivo e nada a iniciar: a seção não existe (contrato de RoteirosDoContato).
  if (!vivo && (!podeEscrever || fluxosAtivos.length === 0)) return null;

  return (
    <section data-testid="inbox-followup">
      <h3 className="text-xs font-semibold text-text">{t("Follow-up")}</h3>
      {vivo ? (
        <div className="mt-2 rounded-md border border-border p-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">
              {nomeDoFluxo(vivo.pointer_id) ?? t("Fluxo de follow-up")}
            </span>
            <Badge variant={tomDoStatus(vivo.status)}>{rotuloDoStatus(vivo.status, t)}</Badge>
          </div>
          {podeEscrever && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              data-testid="parar-followup"
              disabled={salvando}
              onClick={parar}
            >
              {t("Parar follow-up")}
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {/* Select nativo (o mesmo idioma do "Desfecho da demanda"): o teste o
              aciona por selectOptions, sem portal. */}
          <select
            aria-label={t("Fluxo de follow-up")}
            data-testid="escolher-fluxo-followup"
            className="w-full rounded-md border bg-background p-2 text-xs"
            value={escolhido}
            onChange={(e) => setEscolhido(e.target.value)}
          >
            <option value="">{t("Escolha o fluxo")}</option>
            {fluxosAtivos.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            data-testid="iniciar-followup"
            disabled={salvando || !escolhido}
            onClick={iniciar}
          >
            {t("Iniciar follow-up")}
          </Button>
        </div>
      )}
    </section>
  );
}
