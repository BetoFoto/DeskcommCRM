/**
 * O ADAPTADOR DA STRIPE da cobrança do revendedor (spec
 * docs/superpowers/specs/2026-09-29-cobranca-do-revendedor-design.md §6.1).
 *
 * Sem SDK: `fetch` + `node:crypto` (§1.2). Regras, cada uma com caso em
 * stripe.test.ts:
 * - A chave vai SÓ no header `Authorization`: nunca em query string, log,
 *   mensagem de erro, audit ou Sentry. `ErroDoProvedor` leva o status HTTP e o
 *   `code` da Stripe — nunca o `message`, que ecoa pedaço da chave.
 * - O MODO sai do prefixo da chave (`sk_`/`rk_` + `test`/`live`), que a Stripe
 *   não deixa mentir. Chave real só vai para a base oficial: o stub do e2e roda
 *   em loopback e nunca recebe uma.
 * - Todo POST leva `Idempotency-Key`; a nova tentativa (429, 5xx, rede, 409 de
 *   trava) reusa a MESMA chave, então repetir não cria em dobro. No máximo 3
 *   tentativas e 5 s por espera: webhook, cron e tela têm o próprio retry, e
 *   segurar o clique do usuário por minutos é pior que "provedor indisponível".
 * - Toda resposta passa por Zod lendo só o que é usado; forma inesperada vira
 *   `ErroDoProvedor(200, "resposta_invalida")`, que `sincronizar` grava como
 *   `leitura_invalida` sem tocar o estado.
 */

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { logger } from "@/lib/logger";

import { ErroDoProvedor, type AdaptadorDeCobranca, type Modo } from "./contrato";

export const STRIPE_API_BASE = "https://api.stripe.com/v1";

/**
 * A versão da API fixada. Sem o header, a Stripe responde na versão da CONTA,
 * que o revendedor muda no painel — e `current_period_end` (no item desde a
 * basil) ou `invoice.parent` sumiriam sem erro nenhum.
 *
 * DECISÃO (05/10/2026): fica em 2026-03-25.dahlia, de propósito. A Stripe honra
 * a versão fixada, então não há pressa. O changelog, consultado na revisão da
 * Task 14, lista como GA mais recente a 2026-09-30.endive, que REMOVE
 * `payment_method_types` do Checkout Session e unifica `billing_cycle_anchor`
 * entre Subscription e Invoice; e há dahlias posteriores (04-22 … 08-26), que só
 * acrescentam. Nenhum código daqui usa esses dois campos (grep em 05/10/2026),
 * mas a Task 22 e o checkout vão — subir de versão é decisão dela, relendo as
 * quebras da versão-alvo. A prova contra a conta de teste ainda NÃO existe: o
 * scripts/smoke-stripe.ts nasce na Task 22.
 */
export const STRIPE_VERSION = "2026-03-25.dahlia";

/**
 * Marca o que ESTA instalação criou na conta (endpoint e portal), para achar de
 * novo sem guardar id: 16 hex do sha256 da ORIGEM do app. Uma constante igual em
 * toda instalação faria a homologação e a produção de um revendedor, na mesma
 * conta Stripe, apagarem o webhook uma da outra a cada conexão.
 * ponytail: trocar o domínio deixa o endpoint do domínio velho na conta (a Stripe
 * o desativa quando ele falha); um id guardado no banco resolveria, quando pesar.
 */
export function marcaDaInstalacao(urlDoApp: string): string {
  const origem = URL.canParse(urlDoApp) ? new URL(urlDoApp).origin : urlDoApp.trim().toLowerCase();
  return createHash("sha256").update(origem).digest("hex").slice(0, 16);
}

const TENTATIVAS = 3;
const ESPERA_MAXIMA_MS = 5_000;
const TEMPO_LIMITE_MS = 20_000;
const CODIGOS_DE_TRAVA = new Set(["lock_timeout", "idempotency_key_in_use"]);
const PREFIXO_DA_CHAVE = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;
const HOSTS_DE_LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface DependenciasDaStripe {
  /** A chave em claro, lida A CADA chamada (a tela pode trocá-la). `null` = não configurada. */
  lerChave: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** Só a oficial ou loopback (o stub do e2e). Qualquer outra lança na construção. */
  baseUrl?: string;
  esperar?: (ms: number) => Promise<void>;
  agora?: () => Date;
  novaChaveDeIdempotencia?: () => string;
  /** `marcaDaInstalacao(NEXT_PUBLIC_APP_URL)`: o registro (Task 19) injeta. */
  marca: string;
}

export type AdaptadorStripe = Pick<AdaptadorDeCobranca, "id" | "testarChave">;

/** `teste`/`producao` pelo prefixo; `null` = não é chave secreta nem restrita (inclusive `pk_`). */
export function modoDaChaveStripe(chave: string): Modo | null {
  const m = PREFIXO_DA_CHAVE.exec(chave);
  if (!m) return null;
  return m[1] === "live" ? "producao" : "teste";
}

function baseAceita(base: string): boolean {
  if (base === STRIPE_API_BASE) return true;
  if (!URL.canParse(base)) return false;
  const u = new URL(base);
  return (u.protocol === "http:" || u.protocol === "https:") && HOSTS_DE_LOOPBACK.has(u.hostname);
}

/** Corpo `application/x-www-form-urlencoded` no formato aninhado da Stripe (`a[b][0][c]=v`). */
export function emFormulario(dados: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const por = (chave: string, valor: unknown): void => {
    if (valor === undefined || valor === null) return;
    if (Array.isArray(valor)) {
      valor.forEach((item, i) => por(`${chave}[${i}]`, item));
      return;
    }
    if (typeof valor === "object") {
      for (const [k, v] of Object.entries(valor)) por(`${chave}[${k}]`, v);
      return;
    }
    params.append(chave, String(valor));
  };
  for (const [k, v] of Object.entries(dados)) por(k, v);
  return params.toString();
}

const corpoDeErro = z.object({ error: z.object({ code: z.string().optional(), type: z.string().optional() }) });

/** Status HTTP + `code` da Stripe → `ErroDoProvedor`. Nunca o `message`: ele ecoa pedaço da chave. */
export function erroDaStripe(status: number, corpo: unknown): ErroDoProvedor {
  const lido = corpoDeErro.safeParse(corpo);
  const codigo = lido.success ? lido.data.error.code : undefined;
  const tipo = lido.success ? lido.data.error.type : undefined;
  if (status === 401) return new ErroDoProvedor(401, codigo ?? "chave_invalida", false, true);
  if (status === 403) return new ErroDoProvedor(403, codigo ?? "sem_permissao", false, true);
  if (status === 429) return new ErroDoProvedor(429, codigo ?? "rate_limit", true);
  if (status === 409) return new ErroDoProvedor(409, codigo ?? "conflito", CODIGOS_DE_TRAVA.has(codigo ?? ""));
  if (status >= 500) return new ErroDoProvedor(status, codigo ?? "provedor_fora", true);
  return new ErroDoProvedor(status, codigo ?? tipo ?? "recusado", false);
}

function espera(tentativa: number, retryAfter: string | null): number {
  const pedida = retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 500 * 2 ** (tentativa - 1);
  return Math.min(pedida, ESPERA_MAXIMA_MS);
}

function ler<T>(schema: z.ZodType<T>, dados: unknown): T {
  const lido = schema.safeParse(dados);
  if (!lido.success) throw new ErroDoProvedor(200, "resposta_invalida", false);
  return lido.data;
}

const listaQualquer = z.object({ object: z.literal("list") });

export function criarAdaptadorStripe(dep: DependenciasDaStripe): AdaptadorStripe {
  const base = dep.baseUrl ?? STRIPE_API_BASE;
  if (!baseAceita(base)) throw new Error("base da API da Stripe recusada: só a oficial ou loopback");
  const buscar = dep.fetch ?? fetch;
  const esperar = dep.esperar ?? ((ms: number) => new Promise<void>((pronto) => setTimeout(pronto, ms)));
  const novaChave = dep.novaChaveDeIdempotencia ?? randomUUID;

  async function chaveUsavel(): Promise<string> {
    const chave = await dep.lerChave();
    const modo = chave === null ? null : modoDaChaveStripe(chave);
    if (chave === null || modo === null) throw new ErroDoProvedor(null, "sem_chave", false, true);
    if (modo === "producao" && base !== STRIPE_API_BASE) {
      throw new ErroDoProvedor(null, "chave_real_fora_da_stripe", false, true);
    }
    return chave;
  }

  async function chamar(
    metodo: "GET" | "POST" | "DELETE",
    caminho: string,
    corpo?: Record<string, unknown>,
    chaveDeIdempotencia?: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await chaveUsavel()}`,
      "stripe-version": STRIPE_VERSION,
    };
    let body: string | undefined;
    if (metodo === "POST") {
      headers["content-type"] = "application/x-www-form-urlencoded";
      headers["idempotency-key"] = chaveDeIdempotencia ?? novaChave();
      body = emFormulario(corpo ?? {});
    }
    for (let tentativa = 1; ; tentativa += 1) {
      let erro: ErroDoProvedor;
      let pedidoDaStripe: string | null = null;
      let retryAfter: string | null = null;
      try {
        const r = await buscar(`${base}${caminho}`, {
          method: metodo,
          headers,
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        });
        if (r.ok) {
          return await r.json().catch(() => {
            throw new ErroDoProvedor(r.status, "resposta_invalida", false);
          });
        }
        // Corpo de erro que não é JSON (proxy, HTML): fica só o status.
        erro = erroDaStripe(r.status, await r.json().catch(() => null));
        pedidoDaStripe = r.headers.get("stripe-should-retry");
        retryAfter = r.headers.get("retry-after");
      } catch (e) {
        if (e instanceof ErroDoProvedor) throw e;
        erro = new ErroDoProvedor(null, "sem_resposta", true);
      }
      const repetir =
        tentativa < TENTATIVAS && (pedidoDaStripe === "true" || (pedidoDaStripe !== "false" && erro.transitorio));
      if (!repetir) throw erro;
      logger.warn("cobranca.stripe.nova_tentativa", { status: erro.status, codigo: erro.codigo, tentativa });
      await esperar(espera(tentativa, retryAfter));
    }
  }

  async function testarChave(opcoes?: { modoExigido?: Modo }): ReturnType<AdaptadorDeCobranca["testarChave"]> {
    const chave = await dep.lerChave();
    const modo = chave === null ? null : modoDaChaveStripe(chave);
    if (modo === null) return { ok: false, motivo: "chave_invalida" };
    const outroModo = opcoes?.modoExigido !== undefined && opcoes.modoExigido !== modo;
    if (outroModo || (modo === "producao" && base !== STRIPE_API_BASE)) {
      return { ok: false, motivo: "modo_divergente", modo };
    }
    try {
      // `customers` e não `balance`: a chave restrita recomendada (§10) não
      // precisa ler saldo, e o teste mediria uma permissão que a cobrança não usa.
      ler(listaQualquer, await chamar("GET", "/customers?limit=1"));
      return { ok: true, modo };
    } catch (e) {
      if (!(e instanceof ErroDoProvedor)) throw e;
      if (e.status === 401) return { ok: false, motivo: "chave_invalida" };
      if (e.status === 403) return { ok: false, motivo: "sem_permissao" };
      return { ok: false, motivo: "provedor_fora" };
    }
  }

  return {
    id: "stripe",
    testarChave,
  };
}
