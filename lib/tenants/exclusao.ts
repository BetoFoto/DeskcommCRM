/**
 * EXCLUSÃO DE UMA ORGANIZAÇÃO — o procedimento inteiro, na ordem que não deixa
 * órfão.
 *
 * O banco faz a parte transacional (`fn_excluir_organizacao`, migration 0556):
 * lápide na auditoria, cascata em ~155 tabelas, conferência de que nada ficou.
 * O que mora FORA do Postgres não entra numa transação, e por isso a ordem é o
 * desenho:
 *
 *   1. ANTES do banco, só LER o que o desligamento vai precisar — as linhas dos
 *      canais (`inventariarCanaisDaOrganizacao`, em
 *      `lib/channels/desligar-da-organizacao.ts`), a sessão de voz e a conexão
 *      da loja, com as credenciais já decifradas, em memória. Precisa ser
 *      antes: depois da cascata as linhas não existem mais. Nada externo é
 *      tocado neste passo.
 *   2. O banco, numa transação. Se falhar, nada foi apagado e NADA lá fora
 *      caiu: o WhatsApp, a voz e a loja da empresa seguem funcionando, e o
 *      tenant fica suspenso e intacto para o admin tentar de novo.
 *   3. DEPOIS do commit, desligar o que fala com o mundo, só com o inventário:
 *      os canais de mensagem, a voz e os webhooks da loja. Best-effort: um
 *      serviço fora do ar não desfaz a exclusão — o desfecho de cada passo vai
 *      para o registro final, e um `falhou` aqui é sessão órfã no provedor.
 *      Desligar antes e o banco recusar era pior: a empresa ficava sem
 *      WhatsApp e continuava existindo.
 *   4. Os arquivos no Storage (prefixo `<org>/` em todos os buckets) pela API
 *      — apagar `storage.objects` direto deixaria o arquivo no disco.
 *      Repetível: o prefixo é determinístico.
 *   5. Os logins que pertenciam só a esta organização, pelo GoTrue (limpa
 *      sessões, fatores e identidades). Quem o banco ainda referencia fica, e
 *      isso é registrado — não é erro.
 *   6. O registro final (`organization.deletion_completed`).
 *
 * Pré-condição dura, conferida aqui e de novo no banco: a organização está
 * SUSPENSA, a suspensão é ADMINISTRATIVA (a por cobrança é recusada — excluir
 * deixaria a assinatura cobrando no provedor) e a confirmação é o slug dela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import {
  desligarCanaisInventariados,
  inventariarCanaisDaOrganizacao,
} from "@/lib/channels/desligar-da-organizacao";
import { logger } from "@/lib/logger";
import { NuvemshopApiClient } from "@/lib/nuvemshop/api-client";
import { desligarSessaoDeVozNoTransporte } from "@/lib/voice/desparear";
import { getWacallsClient } from "@/lib/wacalls/client";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export type DesfechoExterno = "ok" | "falhou" | "nao_se_aplica";

export interface ResultadoDaExclusao {
  organizacao: string;
  slug: string;
  contagens: Record<string, number>;
  canais: Array<{ id: string; provedor: string; desfecho: DesfechoExterno; motivo?: string }>;
  voz: DesfechoExterno;
  nuvemshop: DesfechoExterno;
  arquivos: { encontrados: number; removidos: number; falhas: number };
  usuarios: { removidos: string[]; mantidos: Array<{ id: string; motivo: string }> };
}

export class ExclusaoRecusada extends Error {
  constructor(
    public readonly codigo:
      | "not_found"
      | "state_conflict"
      | "exclusao_com_cobranca_pendente"
      | "confirmacao_divergente"
      | "motivo_curto",
    message: string,
  ) {
    super(message);
    this.name = "ExclusaoRecusada";
  }
}

interface Entrada {
  orgId: string;
  atorId: string;
  confirmacao: string;
  motivo: string;
  requestId: string;
}

const LOTE_DO_STORAGE = 100;

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const MENSAGEM_DE_COBRANCA =
  "Esta empresa está suspensa por falta de pagamento. Excluí-la deixaria a assinatura cobrando no provedor: resolva a cobrança antes.";

/** Passo 3 — a voz é por organização, não por canal; o id veio do inventário. */
async function desligarVoz(orgId: string, sessaoDeVoz: string | null): Promise<DesfechoExterno> {
  const wacalls = getWacallsClient();
  if (!wacalls || !sessaoDeVoz) return "nao_se_aplica";
  try {
    await desligarSessaoDeVozNoTransporte(wacalls, sessaoDeVoz);
    return "ok";
  } catch (err) {
    logger.warn("[exclusao] falha ao desligar a voz", {
      organization_id: orgId,
      erro: mensagemDe(err),
    });
    return "falhou";
  }
}

interface LojaInventariada {
  storeId: string;
  /** Decifrado antes da transação; `null` quando a credencial não abriu. */
  accessToken: string | null;
  webhookIds: number[];
}

/** Passo 1 — a conexão da loja, lida antes da transação (só leitura). */
async function inventariarNuvemshop(
  admin: SupabaseClient,
  orgId: string,
): Promise<LojaInventariada | null> {
  const { data } = await admin
    .from("tenant_integrations")
    .select("oauth_access_token_encrypted, store_metadata, webhook_subscriptions")
    .eq("organization_id", orgId)
    .eq("provider", "nuvemshop")
    .maybeSingle();
  const linha = data as {
    oauth_access_token_encrypted: string | null;
    store_metadata: { store_id?: string | number } | null;
    webhook_subscriptions: Record<string, { id: number | null }> | null;
  } | null;
  if (!linha?.oauth_access_token_encrypted || !linha.store_metadata?.store_id) return null;
  let accessToken: string | null = null;
  try {
    accessToken = await decryptWebhookSecret(admin, linha.oauth_access_token_encrypted);
  } catch (err) {
    logger.warn("[exclusao] credencial da Nuvemshop ilegível", {
      organization_id: orgId,
      erro: mensagemDe(err),
    });
  }
  const webhookIds = Object.values(linha.webhook_subscriptions ?? {})
    .map((a) => a?.id)
    .filter((id): id is number => typeof id === "number");
  return { storeId: String(linha.store_metadata.store_id), accessToken, webhookIds };
}

/** Passo 3 — os webhooks que a conexão registrou na loja apontam para cá. */
async function desligarNuvemshop(
  orgId: string,
  loja: LojaInventariada | null,
): Promise<DesfechoExterno> {
  if (!loja) return "nao_se_aplica";
  if (!loja.accessToken) return "falhou";
  const client = new NuvemshopApiClient({ storeId: loja.storeId, accessToken: loja.accessToken });
  let falhou = false;
  for (const id of loja.webhookIds) {
    try {
      await client.deleteWebhook(id);
    } catch (err) {
      falhou = true;
      logger.warn("[exclusao] falha ao remover um webhook da Nuvemshop", {
        organization_id: orgId,
        erro: mensagemDe(err),
      });
    }
  }
  return falhou ? "falhou" : "ok";
}

/** Passo 4 — arquivos pelo prefixo `<org>/`, em lotes, pela API do Storage. */
async function limparArquivos(
  admin: SupabaseClient,
  orgId: string,
): Promise<ResultadoDaExclusao["arquivos"]> {
  const { data, error } = await admin.rpc("fn_arquivos_da_organizacao", { p_org: orgId });
  if (error) {
    logger.warn("[exclusao] inventário do Storage falhou", {
      organization_id: orgId,
      erro: error.message,
    });
    return { encontrados: 0, removidos: 0, falhas: 1 };
  }
  const porBucket = new Map<string, string[]>();
  for (const o of (data ?? []) as Array<{ bucket_id: string; name: string }>) {
    porBucket.set(o.bucket_id, [...(porBucket.get(o.bucket_id) ?? []), o.name]);
  }
  let removidos = 0;
  let falhas = 0;
  for (const [bucket, nomes] of porBucket) {
    for (let i = 0; i < nomes.length; i += LOTE_DO_STORAGE) {
      const lote = nomes.slice(i, i + LOTE_DO_STORAGE);
      const { error: remErr } = await admin.storage.from(bucket).remove(lote);
      if (remErr) falhas += lote.length;
      else removidos += lote.length;
    }
  }
  return { encontrados: (data ?? []).length, removidos, falhas };
}

/** Passo 5 — só quem o banco apontou como sem nenhum outro vínculo. */
async function removerLogins(
  admin: SupabaseClient,
  candidatos: string[],
): Promise<ResultadoDaExclusao["usuarios"]> {
  const removidos: string[] = [];
  const mantidos: Array<{ id: string; motivo: string }> = [];
  for (const id of candidatos) {
    const { error } = await admin.auth.admin.deleteUser(id);
    // O banco ainda referencia a pessoa (ex.: autora de um registro que não é
    // da organização excluída): o GoTrue recusa pela FK e o login fica. É o
    // desfecho correto — apagar forçado levaria dado alheio junto.
    if (error) mantidos.push({ id, motivo: error.message });
    else removidos.push(id);
  }
  return { removidos, mantidos };
}

export async function excluirOrganizacao(
  admin: SupabaseClient,
  entrada: Entrada,
): Promise<ResultadoDaExclusao> {
  const motivo = entrada.motivo.trim();
  if (motivo.length < 10) {
    throw new ExclusaoRecusada(
      "motivo_curto",
      "Informe o motivo da exclusão (mínimo 10 caracteres).",
    );
  }

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, slug, status, suspended_kind")
    .eq("id", entrada.orgId)
    .maybeSingle();
  if (orgErr) throw new Error(`exclusao_leitura: ${orgErr.message}`);
  if (!org) throw new ExclusaoRecusada("not_found", "Organização não encontrada.");
  if (org.status !== "suspended") {
    throw new ExclusaoRecusada(
      "state_conflict",
      "Só uma organização suspensa pode ser excluída. Suspenda-a antes.",
    );
  }
  // Tipo nulo vale como administrativa — a régua de `lib/organizacao/operante.ts`.
  if (org.suspended_kind === "cobranca") {
    throw new ExclusaoRecusada("exclusao_com_cobranca_pendente", MENSAGEM_DE_COBRANCA);
  }
  if (entrada.confirmacao !== org.slug) {
    throw new ExclusaoRecusada(
      "confirmacao_divergente",
      "A confirmação não confere com o identificador da organização.",
    );
  }

  // 1. Só leitura: o que o desligamento vai precisar, antes que a cascata
  // apague as linhas. Nada externo é tocado aqui.
  const inventario = await inventariarCanaisDaOrganizacao(admin, entrada.orgId);
  const loja = await inventariarNuvemshop(admin, entrada.orgId);

  // 2. O banco, numa transação.
  const { data: resultado, error: rpcErr } = await admin.rpc("fn_excluir_organizacao", {
    p_org: entrada.orgId,
    p_actor: entrada.atorId,
    p_confirmacao: entrada.confirmacao,
    p_motivo: motivo,
    p_request_id: entrada.requestId,
  });
  if (rpcErr) {
    // Recusas do próprio banco (corrida com uma reativação, ou com uma
    // suspensão que virou cobrança) viram a mesma recusa que a checagem de
    // cima daria. Nada lá fora foi tocado.
    if (rpcErr.code === "PT409" && rpcErr.message === "organizacao_com_cobranca_pendente")
      throw new ExclusaoRecusada("exclusao_com_cobranca_pendente", MENSAGEM_DE_COBRANCA);
    if (rpcErr.code === "PT409")
      throw new ExclusaoRecusada("state_conflict", "A organização não está mais suspensa.");
    if (rpcErr.code === "PT404")
      throw new ExclusaoRecusada("not_found", "Organização não encontrada.");
    throw new Error(`exclusao_banco: ${rpcErr.message}`);
  }
  const banco = resultado as {
    slug: string;
    contagens: Record<string, number>;
    usuarios_removiveis: string[];
  };

  // 3. Depois do commit, o que fala com o mundo — só com o inventário.
  const canais = await desligarCanaisInventariados(inventario);
  const voz = await desligarVoz(entrada.orgId, inventario.sessaoDeVoz);
  const nuvemshop = await desligarNuvemshop(entrada.orgId, loja);

  // 4 e 5. Repetíveis e registrados.
  const arquivos = await limparArquivos(admin, entrada.orgId);
  const usuarios = await removerLogins(admin, banco.usuarios_removiveis ?? []);

  const saida: ResultadoDaExclusao = {
    organizacao: entrada.orgId,
    slug: banco.slug,
    contagens: banco.contagens ?? {},
    canais,
    voz,
    nuvemshop,
    arquivos,
    usuarios,
  };

  // 6. O registro final. `organizationId` nulo: a organização não existe mais,
  // e a trilha dela é achada por `resource_id` (como a lápide).
  await audit({
    action: "organization.deletion_completed",
    actorUserId: entrada.atorId,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: null,
    resourceType: "organization",
    resourceId: entrada.orgId,
    requestId: entrada.requestId,
    metadata: {
      slug: saida.slug,
      canais: saida.canais,
      voz: saida.voz,
      nuvemshop: saida.nuvemshop,
      arquivos: saida.arquivos,
      usuarios_removidos: saida.usuarios.removidos.length,
      usuarios_mantidos: saida.usuarios.mantidos.length,
    },
  });

  return saida;
}
