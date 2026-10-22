/**
 * #2942 — O PROVEDOR `local-http`: engine de scraping self-hosted, sem Apify.
 *
 * ─── O QUE ELE RESOLVE ─────────────────────────────────────────────────────
 *
 * Até aqui o despacho (`provedor.ts`) só conhecia `apify` e `teste`: uma
 * organização que apontasse `settings.prospecting.provider` para um engine
 * próprio caía FECHADO em "Provedor de busca desconhecido nesta organização"
 * (422). Este arquivo é o provedor que faltava, e o que ele NÃO faz é tão
 * importante quanto o que faz — ele não toca em `PROVEDOR_PADRAO`, não muda
 * nada do caminho default da Apify e não cria migration nenhuma.
 *
 * ─── A CREDENCIAL É A URL ──────────────────────────────────────────────────
 *
 * Não há chave de API: o engine roda na mesma rede e se identifica pelo
 * endereço. A URL entra pelo MESMO canal cifrado que já existe
 * (`prospecting_settings.credential_encrypted`, via `configureCredential` em
 * `store.ts`) — nenhuma coluna nova, nenhum caminho novo de segredo. O que
 * muda é só a pergunta que a régua do provedor faz antes de cifrar: em vez de
 * `users/me` da Apify, o HEALTH CHECK do engine.
 *
 * ─── A LÍNGUA DO ENGINE (e o que fica fora desta fatia) ────────────────────
 *
 * O engine alvo é o do kit self-hosted (`gosom/google-maps-scraper`, MIT),
 * cuja API REST é: `POST {base}/api/v1/scrape` para lançar, `GET
 * {base}/api/v1/jobs/{id}` para o estado E os resultados, e `GET
 * {base}/api/v1/health` para o health check. Os estados dele
 * (`pending`/`running`/`completed`/`failed`/`cancelled`) são traduzidos para os
 * que `store.ts` já lê (`RUNNING`/`SUCCEEDED`/`FAILED`), porque `worker.ts` e
 * `guard.ts` não podem mudar por causa de um provedor novo.
 *
 * O que NÃO entra aqui, de propósito:
 *
 * - **Tradução de campos por provedor (F3).** Os itens saem como o engine os
 *   manda e é `normalizeProspect()` (`schema.ts`) que lê `title`/`placeId`/
 *   `phone` — os nomes do Google Maps, que o engine também usa. Um tradutor
 *   por provedor é outra fatia.
 * - **Geocodificação.** O engine aceita `geo_coordinates`; convertê-las de
 *   `location` em texto é parte da tradução de campos. Até lá a consulta vai
 *   inteira no `keyword` (o formato dos próprios exemplos do engine:
 *   "restaurantes em São Paulo"), que é o caminho mais curto e sem inventar
 *   lat/lon de mentira.
 * - **Teto de buscas por dia e pausa entre buscas.** O ritmo que existe hoje é
 *   de ENVIO (`daily_limit`/`interval_minutes`), não de busca. Fica para a
 *   fatia que a issue pedir.
 * - **Rotear pelo provedor que lançou a busca (#2174).** `synchronizeSearch`
 *   continua lendo a escolha ATUAL da organização, como já faz.
 */
import { ProspectingError } from "./provider";
import type { DadosDaExecucao, ProvedorDeBusca } from "./provedor";
import type { SearchInput } from "./schema";

/** Teto de uma chamada ao engine. O scrape em si é assíncrono no engine — aqui só se fala o protocolo. */
const TIMEOUT_MS = 20_000;

/**
 * A URL da organização vira a base das chamadas, ou o erro FECHADO de sempre.
 *
 * `localhost:8080` (sem esquema) é o erro de digitação mais provável — e o mais
 * traiçoeiro: o parser de URL aceita `localhost:` como se fosse o protocolo.
 * Por isso a checagem é do protocolo, não da forma.
 */
export function baseDoEngine(url: string): string {
  const bruta = url.trim().replace(/\/+$/, "");
  if (!bruta) throw new ProspectingError("Informe a URL do engine de busca local.");
  let alvo: URL;
  try {
    alvo = new URL(bruta);
  } catch {
    throw new ProspectingError(
      `A URL do engine de busca local não é válida: ${bruta}. Use o endereço completo, com http:// ou https://.`,
    );
  }
  if (alvo.protocol !== "http:" && alvo.protocol !== "https:")
    throw new ProspectingError(
      `A URL do engine de busca local precisa começar com http:// ou https:// (recebido: ${bruta}).`,
    );
  return bruta;
}

/** O estado do engine na língua que `store.ts` já lê. Estado novo = erro fechado, não palpite. */
function statusDoEngine(status: string): string {
  switch (status.trim().toLowerCase()) {
    case "completed":
      return "SUCCEEDED";
    case "pending":
    case "running":
    case "scheduled":
    case "retryable":
    case "available":
      return "RUNNING";
    case "failed":
    case "cancelled":
    case "discarded":
      return "FAILED";
    default:
      throw new ProspectingError(
        `O engine de busca local devolveu um estado desconhecido: ${status}.`,
        502,
      );
  }
}

/** O estado da execução, ou erro fechado quando o engine não o diz. */
function estado(corpo: CorpoDoJob): string {
  if (typeof corpo.status !== "string" || !corpo.status.trim())
    throw new ProspectingError("O engine de busca local respondeu sem o estado da execução.", 502);
  return statusDoEngine(corpo.status);
}

/** Falha de rede/servidor do engine é 502 — mesma classificação da falha da Apify em `provider.ts`. */
async function pedir(
  url: string,
  caminho: string,
  init?: { method?: string; body?: string },
): Promise<Response> {
  let resposta: Response;
  try {
    resposta = await fetch(`${url}${caminho}`, {
      method: init?.method ?? "GET",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: init?.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ProspectingError(
      `O engine de busca local não respondeu em ${url}. Confira se ele está no ar e se a URL da organização aponta para ele.`,
      502,
    );
  }
  if (!resposta.ok)
    throw new ProspectingError(
      resposta.status === 404
        ? "O engine de busca local não conhece esta busca."
        : `Engine de busca local indisponível (HTTP ${resposta.status}).`,
      502,
    );
  return resposta;
}

/** O corpo de `GET /api/v1/jobs/{id}` — só o que este provedor lê. */
interface CorpoDoJob {
  job_id?: unknown;
  status?: unknown;
  results?: unknown;
}

async function corpoDoJob(url: string, id: string): Promise<CorpoDoJob> {
  const resposta = await pedir(url, `/api/v1/jobs/${encodeURIComponent(id)}`);
  const corpo = (await resposta.json()) as CorpoDoJob;
  if (typeof corpo?.job_id !== "string" || !corpo.job_id)
    throw new ProspectingError(
      "O engine de busca local respondeu sem o identificador da execução.",
      502,
    );
  return corpo;
}

export const provedorLocalHttp: ProvedorDeBusca = {
  async startSearch(url, input: SearchInput): Promise<DadosDaExecucao> {
    const base = baseDoEngine(url);
    const resposta = await pedir(base, "/api/v1/scrape", {
      method: "POST",
      body: JSON.stringify({
        // A consulta inteira vai no keyword: o engine não geocodifica o texto de
        // `location` por nós, e o formato é o dos exemplos dele ("cafes in athens").
        keyword: `${input.niche} em ${input.location}`,
        lang: "pt-BR",
        max_depth: 1,
        timeout: 300,
      }),
    });
    const corpo = (await resposta.json()) as CorpoDoJob;
    if (typeof corpo?.job_id !== "string" || !corpo.job_id)
      throw new ProspectingError(
        "O engine de busca local aceitou a busca mas não devolveu o identificador da execução.",
        502,
      );
    // Sem custo por lugar: o engine é da casa. O campo existe para a campanha
    // continuar guardando a MESMA forma de execução de sempre.
    return {
      id: corpo.job_id,
      status: estado(corpo),
      defaultDatasetId: corpo.job_id,
      usageTotalUsd: 0,
    };
  },
  async readSearch(url, id: string): Promise<DadosDaExecucao> {
    const base = baseDoEngine(url);
    const corpo = await corpoDoJob(base, id);
    return {
      id: corpo.job_id as string,
      status: estado(corpo),
      // Os resultados vêm NO PRÓPRIO job (não há dataset separado como na Apify),
      // então o conjunto é o id da execução — mesma forma de `DadosDaExecucao`.
      defaultDatasetId: corpo.job_id as string,
      usageTotalUsd: 0,
    };
  },
  async readResults(url, dataset: string, limit: number): Promise<Record<string, unknown>[]> {
    const base = baseDoEngine(url);
    const corpo = await corpoDoJob(base, dataset);
    const itens = Array.isArray(corpo.results) ? corpo.results : [];
    return itens
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .slice(0, limit);
  },
};

/**
 * A régua de credencial deste provedor: o HEALTH CHECK do engine. É o que
 * `configureCredential` (`store.ts:127`) pergunta antes de cifrar a URL — a
 * mesma pergunta que a Apify responde em `users/me`, só que aqui é "você é um
 * engine de verdade e está no ar?".
 */
export async function validarCredencialLocalHttp(url: string): Promise<void> {
  const base = baseDoEngine(url);
  const resposta = await pedir(base, "/api/v1/health");
  let corpo: { status?: unknown };
  try {
    corpo = (await resposta.json()) as { status?: unknown };
  } catch {
    throw new ProspectingError(
      `O engine de busca local em ${base} respondeu ao health check com um corpo ilegível.`,
      502,
    );
  }
  if (corpo?.status !== "ok")
    throw new ProspectingError(
      `O engine de busca local em ${base} não confirmou o health check. Confira a URL da organização.`,
      502,
    );
}
