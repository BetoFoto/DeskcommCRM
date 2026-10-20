/**
 * Uma RODADA da importação do histórico do WhatsApp (#999).
 *
 * Lê o acervo do servidor do canal e grava contato, conversa e mensagens do
 * passado SEM nenhum efeito de mensagem nova: não chama o roteador do webhook,
 * nem os efeitos pós-entrada (IA, demanda, campanha, follow-up), nem o carimbo
 * da conversa (`last_message_*`, não lidas), nem `emit_event`. O que os
 * gatilhos de `messages` fariam, a 0704 corta pela chave
 * `metadata.historico_importado = 'true'` que o mapeador põe em toda linha.
 * Mídia é passo à parte: aqui só fica o `media_status` que o mapeador devolve.
 * Auditoria é de quem chama (as rotas).
 *
 * ─── Rodadas curtas que retomam ─────────────────────────────────────────────
 *
 * Cada rodada faz no máximo `teto.conversas` conversas OU `teto.mensagens`
 * mensagens (o que vier primeiro) e grava o cursor
 * `{ indiceConversa, offsetMensagens, desde }`:
 *   - `indiceConversa` é a POSIÇÃO da conversa na lista do canal (ordenada por
 *     id; ver `paginaDeConversas`), contando grupo e status, que ficam de fora;
 *   - `offsetMensagens` é o offset do canal dentro dessa conversa (ordem do
 *     mais antigo para o mais novo, garantida pelo cliente);
 *   - `desde` (epoch em segundos) é fixado na PRIMEIRA rodada: recalcular a
 *     cada rodada faria a janela deslizar e o offset apontar para outro lugar.
 *
 * O offset avança pelo tamanho PEDIDO da página, não pelo devolvido: o cliente
 * descarta localmente o item que o schema recusa, e avançar pelo devolvido
 * repetiria mensagens. A conversa termina quando a página volta vazia.
 *
 * Refazer um pedaço (rodada interrompida antes de gravar o cursor) é seguro: a
 * mensagem já gravada é reconhecida pelo `external_id` e conta como existente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { getWahaClient } from "@/lib/waha/client";
import { ehReacao, notifyNameOf, type WahaPayload } from "@/lib/waha/ingest";
import {
  candidatosDeExternalId,
  identidadeDoChat,
  mapearMensagemDoAcervo,
  type LinhaDeMensagemImportada,
} from "@/lib/whatsapp-historico/mapear";

export interface TetoDaRodada {
  conversas: number;
  mensagens: number;
}

/** 3 conversas OU 300 mensagens por rodada, o que vier primeiro. */
export const TETO_PADRAO: TetoDaRodada = { conversas: 3, mensagens: 300 };

export interface CursorDaImportacao {
  indiceConversa: number;
  offsetMensagens: number;
  /** Epoch em segundos; fixado na primeira rodada. */
  desde?: number;
}

export interface ResultadoDaRodada {
  status: "rodando" | "concluida" | "erro";
  gravadas: number;
  existentes: number;
}

/** Página de mensagens pedida ao canal; menor quando o teto está perto. */
const PAGINA_DE_MENSAGENS = 100;
/** Página de conversas: só a do cursor é processada por vez, mas uma página de
 * grupos inteira é pulada numa chamada só. */
const PAGINA_DE_CONVERSAS = 50;
const SEGUNDOS_POR_DIA = 86_400;

interface Importacao {
  id: string;
  organization_id: string;
  channel_session_id: string;
  status: string;
  dias: number;
  cursor: Partial<CursorDaImportacao> | null;
  conversas_feitas: number | null;
  mensagens_gravadas: number | null;
  mensagens_existentes: number | null;
  mensagens_ignoradas: number | null;
}

function mensagemDeErro(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

export async function rodarUmaRodada(
  admin: SupabaseClient,
  importacaoId: string,
  teto: TetoDaRodada = TETO_PADRAO,
): Promise<ResultadoDaRodada> {
  const { data: lida, error: erroDeLeitura } = await admin
    .from("importacoes_de_historico")
    .select("*")
    .eq("id", importacaoId)
    .maybeSingle();
  if (erroDeLeitura) throw new Error(`importacao_leitura: ${mensagemDeErro(erroDeLeitura)}`);
  const imp = lida as Importacao | null;
  if (!imp) throw new Error("importacao_nao_encontrada");
  if (imp.status === "concluida") return { status: "concluida", gravadas: 0, existentes: 0 };
  if (imp.status !== "rodando") throw new Error("importacao_nao_esta_rodando");

  const cursorSalvo = imp.cursor ?? {};
  const cursor: Required<CursorDaImportacao> = {
    indiceConversa: cursorSalvo.indiceConversa ?? 0,
    offsetMensagens: cursorSalvo.offsetMensagens ?? 0,
    desde: cursorSalvo.desde ?? Math.floor(Date.now() / 1000) - imp.dias * SEGUNDOS_POR_DIA,
  };
  const desta = { conversas: 0, gravadas: 0, existentes: 0, ignoradas: 0 };

  const salvar = async (extra: Record<string, unknown>) => {
    const { error } = await admin
      .from("importacoes_de_historico")
      .update({
        cursor,
        conversas_feitas: (imp.conversas_feitas ?? 0) + desta.conversas,
        mensagens_gravadas: (imp.mensagens_gravadas ?? 0) + desta.gravadas,
        mensagens_existentes: (imp.mensagens_existentes ?? 0) + desta.existentes,
        mensagens_ignoradas: (imp.mensagens_ignoradas ?? 0) + desta.ignoradas,
        updated_at: new Date().toISOString(),
        ...extra,
      } as never)
      .eq("id", importacaoId);
    if (error) throw new Error(`importacao_gravacao: ${mensagemDeErro(error)}`);
  };

  // O cursor que vale em caso de erro é o do último ponto inteiro: o pedaço em
  // andamento é refeito na próxima (a deduplicação absorve a repetição).
  let cursorFirme = { ...cursor };
  let firmes = { ...desta };

  try {
    const canal = getWahaClient();
    if (!canal) throw new Error("canal_nao_configurado");
    const { data: sessao, error: erroDaSessao } = await admin
      .from("channel_sessions")
      .select("waha_session_name")
      .eq("id", imp.channel_session_id)
      .eq("organization_id", imp.organization_id)
      .maybeSingle();
    if (erroDaSessao) throw new Error(`sessao_leitura: ${mensagemDeErro(erroDaSessao)}`);
    const nomeNoCanal = (sessao as { waha_session_name?: string } | null)?.waha_session_name;
    if (!nomeNoCanal) throw new Error("sessao_nao_encontrada");

    let processadas = 0;
    for (;;) {
      if (desta.conversas >= teto.conversas || processadas >= teto.mensagens) {
        await salvar({});
        return { status: "rodando", gravadas: desta.gravadas, existentes: desta.existentes };
      }

      const pagina = await canal.paginaDeConversas(nomeNoCanal, {
        limit: PAGINA_DE_CONVERSAS,
        offset: cursor.indiceConversa,
      });
      if (pagina.lidas === 0) {
        await salvar({ status: "concluida", erro: null });
        return { status: "concluida", gravadas: desta.gravadas, existentes: desta.existentes };
      }
      const conversa = pagina.conversas[0];
      if (!conversa) {
        // Página só de grupo/status: pula inteira.
        cursor.indiceConversa += pagina.lidas;
        cursor.offsetMensagens = 0;
        continue;
      }
      if (conversa.posicao !== cursor.indiceConversa) {
        cursor.indiceConversa = conversa.posicao;
        cursor.offsetMensagens = 0;
      }

      // Conversa sem nada dentro da janela: o canal já diz pela última mensagem.
      if (conversa.ultimaEm !== null && conversa.ultimaEm < cursor.desde) {
        cursor.indiceConversa += 1;
        cursor.offsetMensagens = 0;
        continue;
      }

      let alvo: { contactId: string; conversationId: string } | null = null;
      let conversaTerminou = false;
      while (processadas < teto.mensagens) {
        const limite = Math.min(PAGINA_DE_MENSAGENS, teto.mensagens - processadas);
        const mensagens = await canal.listarMensagens(nomeNoCanal, conversa.chatId, {
          limit: limite,
          offset: cursor.offsetMensagens,
          desde: cursor.desde,
        });
        if (mensagens.length === 0) {
          conversaTerminou = true;
          break;
        }

        const validas: WahaPayload[] = [];
        for (const p of mensagens) {
          if (!p.id || ehReacao(p)) desta.ignoradas += 1;
          else validas.push(p);
        }
        if (validas.length > 0) {
          alvo ??= await garantirContatoEConversa(admin, imp, conversa.chatId, validas);
          if (!alvo) {
            // Chat que não é endereçável (nem telefone nem @lid): nada a gravar nele.
            desta.ignoradas += validas.length;
          } else {
            const r = await gravarMensagens(admin, imp, alvo, validas);
            desta.gravadas += r.gravadas;
            desta.existentes += r.existentes;
          }
        }
        processadas += mensagens.length;
        cursor.offsetMensagens += limite;
        cursorFirme = { ...cursor };
        firmes = { ...desta };
      }

      if (conversaTerminou) {
        desta.conversas += 1;
        cursor.indiceConversa += 1;
        cursor.offsetMensagens = 0;
        cursorFirme = { ...cursor };
        firmes = { ...desta };
      } else {
        // Teto de mensagens no meio da conversa: ela conta para o teto desta
        // rodada (para não começar outra), mas não como feita.
        await salvar({});
        return { status: "rodando", gravadas: desta.gravadas, existentes: desta.existentes };
      }
    }
  } catch (err) {
    Object.assign(cursor, cursorFirme);
    Object.assign(desta, firmes);
    await salvar({ status: "erro", erro: mensagemDeErro(err).slice(0, 500) });
    return { status: "erro", gravadas: desta.gravadas, existentes: desta.existentes };
  }
}

/**
 * Contato pela MESMA RPC e com o MESMO telefone canônico do ingest ao vivo, e
 * conversa pela irmã que não reabre nem distribui. O nome só vem de mensagem
 * RECEBIDA: na enviada, o `pushName` é o do operador.
 */
async function garantirContatoEConversa(
  admin: SupabaseClient,
  imp: Importacao,
  chatId: string,
  mensagens: WahaPayload[],
): Promise<{ contactId: string; conversationId: string } | null> {
  const identidades = mensagens.map(identidadeDoChat);
  const id = identidades.find((x) => x.phone) ?? identidades[0];
  if (!id || (id.kind !== "phone" && id.kind !== "lid")) return null;
  const nome = mensagens
    .filter((p) => p.fromMe !== true)
    .map((p) => notifyNameOf(p)?.trim().slice(0, 200) || null)
    .find((n) => n) ?? null;

  const { data: contactId, error: erroDoContato } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: imp.organization_id,
    p_kind: id.kind,
    p_phone: id.phone ? canonicalPhoneBR(id.phone) : null,
    p_lid: id.kind === "lid" ? id.lid : null,
    p_chat_id: chatId,
    p_notify: nome,
  } as never);
  if (erroDoContato) throw new Error(`fn_upsert_wa_contact: ${mensagemDeErro(erroDoContato)}`);
  if (!contactId) return null;

  const { data: conversationId, error: erroDaConversa } = await admin.rpc(
    "fn_upsert_wa_conversation_importada" as never,
    { p_org: imp.organization_id, p_contact: contactId, p_session: imp.channel_session_id } as never,
  );
  if (erroDaConversa) throw new Error(`fn_upsert_wa_conversation_importada: ${mensagemDeErro(erroDaConversa)}`);
  if (!conversationId) throw new Error("fn_upsert_wa_conversation_importada: sem id");
  return { contactId: contactId as string, conversationId: conversationId as string };
}

/**
 * Consulta antes (por TODOS os candidatos de `external_id`, porque o sufixo do
 * chat muda entre o acervo e o webhook) e insere o resto em lote. O unique
 * `(organization_id, external_id)` é DEFERRABLE e não serve para `on conflict`:
 * um 23505 no lote (corrida com o webhook entre a consulta e o insert) recusa
 * o lote inteiro, e aí cada linha vai sozinha, com o 23505 contado como
 * existente.
 */
async function gravarMensagens(
  admin: SupabaseClient,
  imp: Importacao,
  alvo: { contactId: string; conversationId: string },
  mensagens: WahaPayload[],
): Promise<{ gravadas: number; existentes: number }> {
  const candidatos = mensagens.map(candidatosDeExternalId);
  const { data: achadas, error: erroDaConsulta } = await admin
    .from("messages")
    .select("external_id")
    .eq("organization_id", imp.organization_id)
    .in("external_id", [...new Set(candidatos.flat())]);
  if (erroDaConsulta) throw new Error(`messages_consulta: ${mensagemDeErro(erroDaConsulta)}`);
  const ja = new Set(((achadas ?? []) as Array<{ external_id: string | null }>).map((m) => m.external_id));

  let existentes = 0;
  const novas: LinhaDeMensagemImportada[] = [];
  const vistos = new Set<string>();
  mensagens.forEach((p, i) => {
    const linha = mapearMensagemDoAcervo(p, {
      orgId: imp.organization_id,
      sessionId: imp.channel_session_id,
      contactId: alvo.contactId,
      conversationId: alvo.conversationId,
    });
    // Repetida na própria página também é existente: o lote não pode colidir consigo.
    if ((candidatos[i] ?? []).some((c) => ja.has(c)) || vistos.has(linha.external_id)) {
      existentes += 1;
      return;
    }
    vistos.add(linha.external_id);
    novas.push(linha);
  });
  if (novas.length === 0) return { gravadas: 0, existentes };

  const { error: erroDoLote } = await admin.from("messages").insert(novas as never);
  if (!erroDoLote) return { gravadas: novas.length, existentes };
  if ((erroDoLote as { code?: string }).code !== "23505") {
    throw new Error(`messages_insert: ${mensagemDeErro(erroDoLote)}`);
  }

  let gravadas = 0;
  for (const linha of novas) {
    const { error } = await admin.from("messages").insert(linha as never);
    if (!error) gravadas += 1;
    else if ((error as { code?: string }).code === "23505") existentes += 1;
    else throw new Error(`messages_insert: ${mensagemDeErro(error)}`);
  }
  return { gravadas, existentes };
}
