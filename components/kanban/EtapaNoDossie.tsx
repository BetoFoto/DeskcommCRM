"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Stage } from "@/lib/kanban/types";
import { LoseLeadDialog } from "./LoseLeadDialog";

/**
 * Mudar a etapa SEM sair do dossiê.
 *
 * Antes, o dossiê só MOSTRAVA a etapa (um texto no cabeçalho): quem abria o
 * negócio para agir tinha de fechar o painel, achar o card na coluna e
 * arrastá-lo — ou ir até a conversa, que tem o seletor desde a #2871. O dossiê
 * é justamente onde se decide o próximo passo, e era a única superfície do
 * negócio sem como dá-lo.
 *
 * Quem move é QUEM CHAMA (`onMudar`), não este componente: no quadro é o mesmo
 * `useMoveCard` do arrasto, então a recusa por campos obrigatórios abre o MESMO
 * diálogo (#1536), a trava de `updated_at` é a mesma e a etapa que avisa na
 * Central avisa igual. A etapa de PERDA não move direto — pede o motivo pelo
 * mesmo `LoseLeadDialog` do card e da conversa, senão o funil ganharia uma
 * perda sem motivo por um caminho que nenhuma outra tela permite.
 *
 * Sem permissão de mover (ou sem a lista de etapas — ex.: o calendário, que
 * ainda não a passa), fica o texto de antes: um seletor que recusa no clique
 * seria pior que nenhum.
 */
export function EtapaNoDossie({
  leadId,
  pipelineId,
  etapaAtual,
  etapas,
  podeMover,
  onMudar,
}: {
  leadId: string;
  pipelineId: string;
  etapaAtual: string;
  etapas: Pick<Stage, "id" | "name" | "is_lost">[];
  podeMover: boolean;
  onMudar: (stageId: string) => void;
}) {
  const t = useT();
  const [perdendo, setPerdendo] = useState(false);
  const nomeAtual = etapas.find((e) => e.id === etapaAtual)?.name ?? "—";

  if (!podeMover || etapas.length === 0) {
    return <span className="text-text-muted">{nomeAtual}</span>;
  }

  function escolher(stageId: string) {
    if (stageId === etapaAtual) return;
    if (etapas.find((e) => e.id === stageId)?.is_lost) {
      setPerdendo(true);
      return;
    }
    onMudar(stageId);
  }

  return (
    <span data-testid="dossie-etapa">
      <Select value={etapaAtual} onValueChange={escolher}>
        <SelectTrigger aria-label={t("Etapa do funil")} className="h-7 w-auto gap-1 px-2 text-xs" data-testid="dossie-etapa-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {etapas.map((e) => (
            <SelectItem key={e.id} value={e.id} className="text-xs">
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <LoseLeadDialog open={perdendo} onOpenChange={setPerdendo} leadId={leadId} pipelineId={pipelineId} />
    </span>
  );
}
