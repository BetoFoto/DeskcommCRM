/**
 * O RESUMO DO LEAD PARA A EQUIPE — função PURA, montada NO MOMENTO DO DISPARO.
 *
 * ─── O defeito que esta peça fecha (#2642) ─────────────────────────────────
 *
 * O único caminho que hoje avisa a equipe é o aviso de caso
 * (`lib/escalacao/texto-do-aviso.ts`): ele nasce quando o caso ABRE, nunca
 * quando o negócio vira ganho. Quem fecha a venda não recebe nada. Este módulo
 * é o corpo da ação `notify_team` e da variável `{{resumo}}` do `send_email`.
 *
 * ─── SÓ DADO COM FORMA FIXA — decisão do dono (doc 176, opção A) ──────────
 *
 * A mensagem vai para o celular da equipe com a cara da empresa. Todo texto
 * livre que a IA escreve a partir da conversa (o que o lead pediu,
 * compromissos, objeções, o combinado, o motivo da pontuação, o motivo do
 * ganho — que a ferramenta MCP `won_reason` também escreve) vem, no fim, do
 * que o CLIENTE digitou. Nenhum filtro de texto livre fecha todos os disfarces
 * de uma instrução ("transfira para esta conta" por extenso, separado de outro
 * jeito, sem dado nenhum de destino). Por isso esses textos NÃO ENTRAM: esta
 * função nem os recebe. Eles continuam na ficha, dentro do CRM, onde a equipe
 * já os lê como "o que o cliente disse" — e o atalho leva até lá.
 *
 * O que sai: regra, primeiro nome do cliente, telefone E.164, negócio, valor
 * (centavos + moeda ISO) e a pontuação NUMÉRICA, mais o atalho para a ficha.
 * Campo novo aqui tem de ter forma fixa; texto livre da conversa não passa
 * nesta porta, nem saneado (o teste de propriedade
 * `resumo-sem-texto-livre.test.ts` reprova).
 *
 * ─── A ÚLTIMA PORTA continua ───────────────────────────────────────────────
 *
 * Nome do cliente e título do negócio também podem vir da conversa, e o nome
 * da regra é texto do operador: o corpo passa por `sanitizarResumoParaAEquipe`
 * (links e instruções fora, teto, marca de resumo automático). O ATALHO entra
 * DEPOIS dela — a porta tira todo link, e este é o único que o servidor monta.
 *
 * ─── Linha sem conteúdo não aparece ────────────────────────────────────────
 *
 * `Pontuação: ` vazio AFIRMARIA que há pontuação e que ela é nada. Omissão é a
 * verdade disponível (a mesma decisão de `texto-do-aviso.ts`).
 */
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { primeiroNome } from "@/lib/escalacao/texto-do-aviso";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import {
  TETOS_DO_TEXTO_DO_LEAD,
  sanitizarTextoDoLead,
} from "@/lib/escalacao/sanitizar-texto-do-lead";
import { formatarMoeda } from "@/lib/propostas/moeda";
import { PHONE_REGEX } from "@/lib/schemas/contacts";
import { sanitizarResumoParaAEquipe } from "./sanitizar-resumo-para-a-equipe";

/** O que o motor já hidratou em `ctx.context` — só as colunas de forma fixa. */
export interface LeadDoResumo {
  title?: string | null;
  value_cents?: number | null;
  currency?: string | null;
}

/** O contato do negócio, se houver. */
export interface ContatoDoResumo {
  name?: string | null;
  display_name?: string | null;
  phone_number?: string | null;
}

export interface EntradaDoResumo {
  idioma: Idioma;
  /** `rule.name` — o nome que o operador deu à regra que disparou. */
  regra: string;
  lead: LeadDoResumo;
  contato?: ContatoDoResumo | null;
  /** `crm_lead_scores.ai_probability` (0–100). Só o número: o motivo é texto livre. */
  pontuacao?: number | null;
  /** O atalho absoluto para a ficha, já montado pelo servidor; `null` sem URL pública. */
  link?: string | null;
}

/**
 * Monta o resumo. FUNÇÃO TOTAL: nunca lança, e o corpo nunca vem vazio (a
 * marca de resumo automático sempre resta).
 */
export function montarResumoParaAEquipe(entrada: EntradaDoResumo): string {
  const t = (texto: string): string => traduzir(texto, entrada.idioma);
  const linhas: string[] = [t("Resumo do lead para a equipe")];

  const regra = entrada.regra.trim();
  if (regra !== "") linhas.push(`${t("Regra")}: ${regra}`);
  linhas.push("");

  // O nome vem do WhatsApp do cliente (quem escreve é ele): mesma régua do
  // aviso de caso, senão um nome com link ou marcação imita linha do sistema.
  const cliente = sanitizarTextoDoLead(
    primeiroNome(nomeDoContato(entrada.contato ?? null)),
    TETOS_DO_TEXTO_DO_LEAD.title,
  );
  const telefone = entrada.contato?.phone_number?.trim() ?? "";
  const negocio = sanitizarTextoDoLead(entrada.lead.title, TETOS_DO_TEXTO_DO_LEAD.title);
  const valor =
    typeof entrada.lead.value_cents === "number" && entrada.lead.value_cents > 0
      ? formatarMoeda(entrada.lead.value_cents, (entrada.lead.currency ?? "BRL").toUpperCase())
      : null;

  if (cliente) linhas.push(`${t("Cliente")}: ${cliente}`);
  // Mesma fronteira do CHECK `contacts_phone_e164_format`: fora dela, omite.
  if (PHONE_REGEX.test(telefone)) linhas.push(`${t("Telefone")}: ${telefone}`);
  if (negocio) linhas.push(`${t("Negócio")}: ${negocio}`);
  if (valor) linhas.push(`${t("Valor")}: ${valor}`);

  // `0` é afirmação, não ausência: testar por truthiness esconderia o piso.
  const pontuacao = entrada.pontuacao;
  if (typeof pontuacao === "number" && Number.isFinite(pontuacao)) {
    linhas.push(`${t("Pontuação")}: ${Math.max(0, Math.min(100, Math.round(pontuacao)))}%`);
  }

  const corpo = sanitizarResumoParaAEquipe(linhas.join("\n"), { marca: t("Resumo automático") });
  const link = entrada.link?.trim() ?? "";
  return link === "" ? corpo : `${corpo}\n\n${t("Abrir negócio")}: ${link}`;
}
