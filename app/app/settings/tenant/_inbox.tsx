"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { atualizarInterfaceDaEmpresa } from "@/app/actions/settings/atualizarInterfaceDaEmpresa";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { lerInterface, type InterfaceSettings } from "@/lib/navigation/interface";

interface Props {
  /** O que está gravado hoje em `organizations.interface_settings`. */
  initial: unknown;
}

/**
 * O bloqueio da caixa de mensagem até assumir (#3012), em
 * Configurações → Empresa — o mesmo cartão de preferências da ORGANIZAÇÃO que já
 * grava `interface_settings`.
 *
 * A regra viaja na preferência que já existe (nenhum schema novo) e por isso não
 * tem formulário próprio no banco: o que este cartão faz é ligar e desligar UMA
 * chave e mandar o objeto inteiro pela action de sempre. Guardar o objeto
 * INTEIRO, e não só a chave, é o que impede esta tela de apagar a escolha de
 * menu que a pessoa fez logo acima — as duas moram no mesmo campo.
 *
 * Ligada, vale para a EMPRESA toda: não é preferência de um vínculo, e não
 * concede nem tira acesso. Desligada é o padrão de quem nunca abriu esta tela.
 */
export function InboxDaEmpresaForm({ initial }: Props) {
  const t = useT();
  const [value, setValue] = useState<InterfaceSettings>(() => lerInterface(initial).settings);
  const [isPending, startTransition] = useTransition();
  const ligado = value.bloquearAteAssumir === true;

  function salvar() {
    startTransition(async () => {
      const resultado = await atualizarInterfaceDaEmpresa(value);
      if (resultado.ok) {
        toast.success(t("Bloqueio da caixa de mensagem salvo."));
        return;
      }
      toast.error(t("Não foi possível salvar o bloqueio da caixa de mensagem."));
    });
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-medium">{t("Inbox")}</h2>
      <p className="text-xs text-muted-foreground">
        {t(
          "Regras de atendimento que valem para esta empresa inteira. Não mudam permissões: papel e acesso continuam decidindo o que cada pessoa alcança.",
        )}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ligado}
          onChange={(e) => setValue((atual) => ({ ...atual, bloquearAteAssumir: e.target.checked }))}
          className="mt-1"
        />
        <span>
          {t("Bloquear a caixa de mensagem até o atendente assumir a conversa")}
          <span className="block text-xs text-muted-foreground">
            {t(
              "Com a opção ligada, quem abre uma conversa sem responsável não consegue digitar nem enviar até clicar em Assumir. O botão Assumir continua sempre visível, e quem já assumiu continua respondendo normalmente.",
            )}
          </span>
        </span>
      </label>
      <Button type="button" size="sm" disabled={isPending} onClick={salvar}>
        {t("Salvar")}
      </Button>
    </Card>
  );
}
