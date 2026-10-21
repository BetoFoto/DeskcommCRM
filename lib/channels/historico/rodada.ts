/**
 * Uma RODADA da importação do histórico do WhatsApp (#999).
 *
 * Lê o acervo do servidor do canal e grava contato, conversa e mensagens do
 * passado SEM nenhum efeito de mensagem nova: não chama o roteador do webhook,
 * nem os efeitos pós-entrada (IA, demanda, campanha, follow-up), nem o carimbo
 * da conversa (`last_message_*`, não lidas), nem `emit_event`. O que os
 * gatilhos de `messages` fariam, a 0704 corta pela chave
 * `metadata.historico_importado = 'true'` que o mapeador põe em toda linha.
 * Mídia (só imagem e áudio): logo depois de gravar cada página, `resolverMidias`
 * pede ao canal a URL; com URL, grava `media_url` e emite `media.persist_requested`
 * (o worker guarda no storage e, por causa da chave do histórico, NÃO deriva);
 * sem URL (`erro: true`), marca `indisponivel` e não tenta de novo. Vídeo,
 * documento e figurinha ficam `fora_do_escopo`, sem chamada. Se o teto de
 * chamadas acabar no meio das mídias da página, a rodada para ANTES de firmar o
 * cursor dela: a página é refeita, as mensagens contam como existentes e só as
 * mídias ainda `pendente` são tentadas.
 * Auditoria é de quem chama (as rotas).
 *
 * ─── Rodadas curtas que retomam ─────────────────────────────────────────────
 *
 * Cada rodada faz no máximo `teto.conversas` conversas OU `teto.mensagens`
 * mensagens OU `teto.chamadas` chamadas ao canal (o que vier primeiro) e grava
 * o cursor
 * `{ indiceConversa, offsetMensagens, desde }`:
 *   - `indiceConversa` é a POSIÇÃO da conversa na lista do canal (ordenada por
 *     id; ver `paginaDeConversas`), contando grupo e status, que ficam de fora;
 *   - `offsetMensagens` é o offset do canal dentro dessa conversa (ordem do
 *     mais antigo para o mais novo, garantida pelo cliente);
 *   - `desde` (epoch em segundos) é fixado na PRIMEIRA rodada: recalcular a
 *     cada rodada faria a janela deslizar e o offset apontar para outro lugar.
 *
 * O offset avança por `lidas`, o que o canal DEVOLVEU antes do schema local
 * (`paginaDeMensagens`): avançar pelo pedido pularia mensagens quando o canal
 * devolve menos, e avançar pelo que sobrou do schema repetiria. A conversa só
 * termina com `lidas === 0`: página inteira recusada pelo schema não é fim.
 *
 * Refazer um pedaço (rodada interrompida antes de gravar o cursor) é seguro: a
 * mensagem já gravada é reconhecida pelo `external_id` e conta como existente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { getWahaClient } from "@/lib/waha/client";
import { ehReacao, notifyNameOf, type WahaPayload } from "@/lib/waha/ingest";
import {
  candidatosDeExternalId,
  identidadeDoChat,
  mapearMensagemDoAcervo,
  type LinhaDeMensagemImportada,
} from "@/lib/channels/historico/mapear";

export interface TetoDaRodada {
  conversas: number;
  mensagens: number;
  /**
   * Chamadas ao canal por rodada (páginas de conversas + páginas de mensagens).
   * Sem ele, uma conta com centenas de conversas antigas ou de grupos faria a
   * rodada andar a lista inteira, já que essas não contam como conversa feita.
   */
  chamadas?: number;
}

/** 3 conversas OU 300 mensagens OU 20 chamadas ao canal por rodada, o que vier primeiro. */
export const TETO_PADRAO: Required<TetoDaRodada> = { conversas: 3, mensagens: 300, chamadas: 20 };

export interface CursorDaImportacao {
  indiceConversa: number;
  offsetMensagens: number;
  /** Epoch em segundos; fixado na primeira rodada. */
  desde?: number;
}

export type StatusDaImportacao = "previa" | "rodando" | "concluida" | "erro" | "cancelada";

export interface ResultadoDaRodada {
  /**
   * `rodando`/`concluida`/`erro` vêm desta rodada. Outro valor (`cancelada`,
   * por exemplo) é o que a linha tinha quando a rodada foi gravar e encontrou
   * a importação fora de `rodando`: a rodada não sobrescreve.
   */
  status: StatusDaImportacao;
  gravadas: number;
  existentes: number;
}

/** Página de mensagens pedida ao canal; menor quando o teto está perto. */
const PAGINA_DE_MENSAGENS = 100;
/** Página de conversas: processada inteira em memória (grupo, status e conversa
 * antiga são pulados sem nova chamada). */
const PAGINA_DE_CONVERSAS = 50;
const SEGUNDOS_POR_DIA = 86_400;
/** Falhas de transporte do canal na mesma mídia antes de marcá-la indisponível. */
const LIMITE_DE_TENTATIVAS_DE_MIDIA = 3;
/**
 * Orçamento, em bytes codificados, dos `external_id` de UMA consulta de
 * deduplicação. Uma página de 100 mensagens de chat `@s.whatsapp.net` dá 300
 * candidatos de até ~70 B cada (13 a 19 KB de URL), e o Kong 2.8.1 devolve 414
 * acima de 8.192 B. Com 4 KB de valores, a URL inteira fica perto de 4,3 KB.
 */
const BYTES_DE_CANDIDATOS_POR_CONSULTA = 4096;

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
  midias_baixadas: number | null;
  midias_indisponiveis: number | null;
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
  // Fora de `desta` de propósito: mídia resolvida não volta a `pendente` quando a
  // rodada recua o cursor, então o contador não pode recuar junto.
  const midias = { baixadas: 0, indisponiveis: 0 };

  /**
   * Grava SÓ se a importação ainda está `rodando`: um cancelamento feito
   * durante a rodada não vira `concluida`. NÃO serializa duas execuções
   * simultâneas da mesma importação (as duas veem `rodando`); isso é de quem
   * dispara a rodada. O índice único parcial da 0705 só impede duas
   * importações `rodando` no mesmo número.
   * Devolve `null` quando gravou, ou o status que a linha tem quando não gravou.
   */
  const salvar = async (extra: Record<string, unknown>): Promise<StatusDaImportacao | null> => {
    const { data, error } = await admin
      .from("importacoes_de_historico")
      .update({
        cursor,
        conversas_feitas: (imp.conversas_feitas ?? 0) + desta.conversas,
        mensagens_gravadas: (imp.mensagens_gravadas ?? 0) + desta.gravadas,
        mensagens_existentes: (imp.mensagens_existentes ?? 0) + desta.existentes,
        mensagens_ignoradas: (imp.mensagens_ignoradas ?? 0) + desta.ignoradas,
        midias_baixadas: (imp.midias_baixadas ?? 0) + midias.baixadas,
        midias_indisponiveis: (imp.midias_indisponiveis ?? 0) + midias.indisponiveis,
        updated_at: new Date().toISOString(),
        ...extra,
      } as never)
      .eq("id", importacaoId)
      .eq("status", "rodando")
      .select("id");
    if (error) throw new Error(`importacao_gravacao: ${mensagemDeErro(error)}`);
    if ((data ?? []).length > 0) return null;
    const { data: atual, error: erroDoAtual } = await admin
      .from("importacoes_de_historico")
      .select("*")
      .eq("id", importacaoId)
      .maybeSingle();
    if (erroDoAtual) throw new Error(`importacao_leitura: ${mensagemDeErro(erroDoAtual)}`);
    return (atual as { status?: StatusDaImportacao } | null)?.status ?? "cancelada";
  };

  const encerrar = async (
    status: "rodando" | "concluida" | "erro",
    extra: Record<string, unknown> = {},
  ): Promise<ResultadoDaRodada> => {
    const outro = await salvar(status === "rodando" ? extra : { status, ...extra });
    return { status: outro ?? status, gravadas: desta.gravadas, existentes: desta.existentes };
  };

  // O cursor que vale ao parar por erro é o do último ponto inteiro: o pedaço em
  // andamento é refeito na próxima (a deduplicação absorve a repetição).
  let cursorFirme = { ...cursor };
  let firmes = { ...desta };
  const firmar = () => {
    cursorFirme = { ...cursor };
    firmes = { ...desta };
  };

  const tetoDeChamadas = teto.chamadas ?? TETO_PADRAO.chamadas;
  let chamadas = 0;
  let processadas = 0;
  const noTeto = () =>
    desta.conversas >= teto.conversas || processadas >= teto.mensagens || chamadas >= tetoDeChamadas;

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

    for (;;) {
      if (noTeto()) return await encerrar("rodando");

      const offsetDaPagina = cursor.indiceConversa;
      chamadas += 1;
      const pagina = await canal.paginaDeConversas(nomeNoCanal, {
        limit: PAGINA_DE_CONVERSAS,
        offset: offsetDaPagina,
      });
      if (pagina.lidas === 0) return await encerrar("concluida", { erro: null });

      for (const conversa of pagina.conversas) {
        if (conversa.posicao < cursor.indiceConversa) continue;
        if (conversa.posicao > cursor.indiceConversa) {
          cursor.indiceConversa = conversa.posicao;
          cursor.offsetMensagens = 0;
        }

        // Conversa sem nada dentro da janela: o canal já diz pela última
        // mensagem, e a página já está em memória (sem nova chamada).
        if (conversa.ultimaEm !== null && conversa.ultimaEm < cursor.desde) {
          cursor.indiceConversa += 1;
          cursor.offsetMensagens = 0;
          firmar();
          continue;
        }

        let alvo: { contactId: string; conversationId: string } | null = null;
        for (;;) {
          if (noTeto()) return await encerrar("rodando");
          const limite = Math.min(PAGINA_DE_MENSAGENS, teto.mensagens - processadas);
          chamadas += 1;
          const { mensagens, lidas } = await canal.paginaDeMensagens(nomeNoCanal, conversa.chatId, {
            limit: limite,
            offset: cursor.offsetMensagens,
            desde: cursor.desde,
          });
          // Só `lidas === 0` é fim: página inteira recusada pelo schema não é.
          if (lidas === 0) break;

          // O que o schema recusou também foi lido e não vira linha.
          const ignoradasAntes = desta.ignoradas;
          desta.ignoradas += lidas - mensagens.length;
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
              const completa = await resolverMidias(admin, imp, canal, nomeNoCanal, conversa.chatId, alvo.conversationId, validas, {
                noTeto,
                contarChamada: () => {
                  chamadas += 1;
                },
                midias,
              });
              if (!completa) {
                // Teto de chamadas no meio das mídias: a página inteira é refeita
                // na próxima rodada, então o cursor fica no último ponto firme.
                Object.assign(cursor, cursorFirme);
                desta.ignoradas = ignoradasAntes;
                return await encerrar("rodando");
              }
            }
          }
          processadas += lidas;
          // Avança pelo que o canal DEVOLVEU, não pelo que foi pedido.
          cursor.offsetMensagens += lidas;
          firmar();
        }

        desta.conversas += 1;
        cursor.indiceConversa += 1;
        cursor.offsetMensagens = 0;
        firmar();
        if (noTeto()) return await encerrar("rodando");
      }

      // Página esgotada: o que sobrou depois da última conversa 1:1 era grupo ou status.
      if (offsetDaPagina + pagina.lidas > cursor.indiceConversa) {
        cursor.indiceConversa = offsetDaPagina + pagina.lidas;
        cursor.offsetMensagens = 0;
      }
      firmar();
    }
  } catch (err) {
    Object.assign(cursor, cursorFirme);
    Object.assign(desta, firmes);
    return await encerrar("erro", { erro: mensagemDeErro(err).slice(0, 500) });
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
  const { data: achadas, error: erroDaConsulta } = await buscaEmLotes(
    [...new Set(candidatos.flat())],
    (lote) =>
      admin.from("messages").select("external_id").eq("organization_id", imp.organization_id).in("external_id", lote),
    { bytesPorLote: BYTES_DE_CANDIDATOS_POR_CONSULTA },
  );
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

/** Cliente do canal, só com o que `resolverMidias` usa. */
type CanalDeMidia = { baixarMidiaDaMensagem(session: string, chatId: string, messageId: string): Promise<{ url: string | null; erro: boolean }> };

/**
 * Resolve a mídia (imagem e áudio) das mensagens DESTA página, as recém-gravadas
 * e as que já existiam como `pendente` (página refeita). Devolve `false` quando o
 * teto de chamadas acabou antes de resolver todas: quem chama não firma o cursor.
 *
 * Erro de transporte (exceção do canal) NÃO é tratado aqui: sobe para a rodada,
 * que para com o cursor firme anterior e tenta de novo depois. Só `erro: true`
 * (o canal diz que a mídia não existe mais) vira `indisponivel`.
 */
async function resolverMidias(
  admin: SupabaseClient,
  imp: Importacao,
  canal: CanalDeMidia,
  nomeNoCanal: string,
  chatId: string,
  conversationId: string,
  mensagens: WahaPayload[],
  ctl: {
    noTeto: () => boolean;
    contarChamada: () => void;
    midias: { baixadas: number; indisponiveis: number };
  },
): Promise<boolean> {
  // external_id candidato -> id da mensagem no canal, só das que o mapeador marca `pendente`.
  const idNoCanal = new Map<string, string>();
  for (const p of mensagens) {
    const linha = mapearMensagemDoAcervo(p, {
      orgId: imp.organization_id,
      sessionId: imp.channel_session_id,
      contactId: "",
      conversationId,
    });
    if (linha.metadata.media_status !== "pendente" || !p.id) continue;
    for (const c of candidatosDeExternalId(p)) idNoCanal.set(c, p.id);
  }
  if (idNoCanal.size === 0) return true;

  const { data, error } = await buscaEmLotes(
    [...idNoCanal.keys()],
    (lote) =>
      admin
        .from("messages")
        .select("id, external_id, metadata")
        .eq("organization_id", imp.organization_id)
        .in("external_id", lote),
    { bytesPorLote: BYTES_DE_CANDIDATOS_POR_CONSULTA },
  );
  if (error) throw new Error(`messages_consulta_midia: ${mensagemDeErro(error)}`);

  const linhas = (data ?? []) as Array<{ id: string; external_id: string; metadata: Record<string, unknown> | null }>;
  for (const linha of linhas) {
    const meta = linha.metadata ?? {};
    // Só o que o importador marcou e ainda ninguém resolveu.
    if (meta.historico_importado !== "true" || meta.media_status !== "pendente") continue;
    const messageIdNoCanal = idNoCanal.get(linha.external_id);
    if (!messageIdNoCanal) continue;

    if (ctl.noTeto()) return false;
    ctl.contarChamada();
    let resposta: { url: string | null; erro: boolean };
    try {
      resposta = await canal.baixarMidiaDaMensagem(nomeNoCanal, chatId, messageIdNoCanal);
    } catch (err) {
      // Limite de 3 tentativas por mensagem: sem ele, uma mídia que o canal
      // recusa SEMPRE (ex.: 500) derrubaria toda rodada na mesma página, e as
      // mídias seguintes nunca seriam alcançadas. Nas duas primeiras a rodada
      // para em erro (cursor firme anterior); na terceira desiste e segue.
      const tentativas = (typeof meta.tentativas_midia === "number" ? meta.tentativas_midia : 0) + 1;
      if (tentativas < LIMITE_DE_TENTATIVAS_DE_MIDIA) {
        await atualizarMensagem(admin, imp, linha.id, { metadata: { ...meta, tentativas_midia: tentativas } });
        throw err;
      }
      await atualizarMensagem(admin, imp, linha.id, {
        metadata: { ...meta, tentativas_midia: tentativas, media_status: "indisponivel" },
      });
      ctl.midias.indisponiveis += 1;
      continue;
    }
    const { url, erro } = resposta;

    if (!url) {
      // `erro: true` é "indisponível, não tente de novo". Sem URL e sem erro o
      // canal não devolveu o arquivo agora (não é veredito): fica `pendente`, sem
      // contar, e a rodada segue. Só uma página refeita voltaria a tentar.
      if (erro) {
        await atualizarMensagem(admin, imp, linha.id, { metadata: { ...meta, media_status: "indisponivel" } });
        ctl.midias.indisponiveis += 1;
      }
      continue;
    }

    // `solicitada` (e não `pendente`) para uma página refeita não pedir de novo; o
    // worker troca por `stored`. Leia-modifique-escreva: `historico_importado` fica.
    await atualizarMensagem(admin, imp, linha.id, {
      media_url: url,
      metadata: { ...meta, media_status: "solicitada" },
    });
    const { error: erroDoEmit } = await admin.rpc("emit_event" as never, {
      p_event_type: "media.persist_requested",
      p_entity_kind: "message",
      p_entity_id: linha.id,
      p_payload: { message_id: linha.id, conversation_id: conversationId },
      p_metadata: { source: "historico_importado" },
      p_organization_id: imp.organization_id,
    } as never);
    if (erroDoEmit) {
      // Desfaz para a próxima rodada tentar de novo; o pedido não saiu.
      await atualizarMensagem(admin, imp, linha.id, { media_url: null, metadata: meta });
      throw new Error(`emit_event: ${mensagemDeErro(erroDoEmit)}`);
    }
    ctl.midias.baixadas += 1;
  }
  return true;
}

async function atualizarMensagem(
  admin: SupabaseClient,
  imp: Importacao,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("messages")
    .update(patch as never)
    .eq("id", id)
    .eq("organization_id", imp.organization_id);
  if (error) throw new Error(`messages_update_midia: ${mensagemDeErro(error)}`);
}
