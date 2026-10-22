/**
 * O ATESTADO DE ANONIMIZAÇÃO — o pedido do titular com prova de quem, quando e de onde.
 *
 * ─── Por que um DOCUMENTO, e não só o aviso em texto (#2342) ────────────────
 *
 * O aviso do art. 12.º, n.º 3 já DIZ ao titular que os dados foram apagados
 * (`lib/lgpd/avisos-do-artigo-12.ts`). O que ele não dá é o papel: um e-mail é
 * texto, e quem recebe um pedido de exclusão costuma precisar depois de algo
 * datado, com origem e responsável. Demonstrar o que foi feito com o pedido é
 * obrigação do controlador (o dever de prestar contas — LGPD art. 37 e RGPD
 * art. 5.º, 2), e a única forma de o titular guardar isso é um documento.
 *
 * ─── O documento DESCREVE o fato; quem diz a norma é o perfil do país ───────
 *
 * A citação legal entra pela MESMA função do resto do produto (`citacaoDaLei`,
 * do perfil da organização): país sem citação revisada não cita artigo nenhum,
 * porque artigo errado num documento que vai ao titular é pior que artigo
 * nenhum. Nada aqui monta frase jurídica própria — quando o perfil não tem
 * citação, o documento fala só do que aconteceu.
 *
 * ─── Mascaramento: o documento é sobre o titular e circula por e-mail ───────
 *
 * Documento que viaja por e-mail pode ser encaminhado. O documento do titular e
 * os contatos saem MASCARADOS, com os mesmos helpers da tela e do relatório do
 * art. 18, II (`mask.ts`): o bastante para o titular se reconhecer (os quatro
 * dígitos finais, o domínio do e-mail), insuficiente para o atestado virar, ele
 * mesmo, um vazamento. Quem quiser o número inteiro no papel muda UM ponto:
 * `mascararDocumento`. O documento do CONTROLADOR (CNPJ) sai inteiro — dado
 * público de empresa, e é ele que diz de quem é o documento.
 *
 * ─── O código de autenticidade, e o que ele NÃO é ──────────────────────────
 *
 * `codigoDeAutenticidade` é HMAC-SHA256 da linha canônica (ver `linhaCanonica`)
 * com a `LGPD_SIGNING_KEY` da instalação — a mesma chave do `pades-signer`. Ele
 * prova duas coisas que o texto sozinho não prova: (1) o documento saiu DESTA
 * instalação, porque sem a chave ninguém reproduz o código; (2) os campos
 * declarados são estes, porque um caractere editado muda o HMAC. Sem chave, o
 * código degrada para SHA-256 da MESMA linha e o rótulo impresso muda: uma
 * instalação sem chave não pode afirmar autenticidade, só integridade — e o
 * documento diz qual dos dois está lendo, em vez de exibir o mesmo selo para
 * coisas diferentes. Assinatura digital (PAdES) continua sendo do
 * `pades-signer`, com o estado que ele já reporta.
 *
 * O `sha256` do PDF NÃO entra no documento (seria referência circular: o hash
 * dos bytes muda o conteúdo que ele hasheia). Ele é gravado junto do código em
 * `lgpd_requests.result.atestado` e na trilha de auditoria, que é onde um
 * auditor confere o arquivo.
 */
import { createHash, createHmac } from "node:crypto";

import { maskEmail, maskPhone, mascaraCpf } from "@/lib/lgpd/mask";

/** Versão do FORMATO. Entra na linha canônica: mudar o layout muda o código. */
export const VERSAO_DO_ATESTADO = "atestado-de-anonimizacao.v1";

/** O documento do titular e os contatos mascarados — o que o papel declara. */
export interface ParteDoAtestado {
  /** Nome (pessoa) ou razão social (empresa); "não informado" quando ausente. */
  nome: string;
  /** Documento do titular JÁ MASCARADO; `null` quando ele não foi declarado. */
  documento: string | null;
  /** Rótulo do documento do titular: "CPF", "CNPJ" ou "Documento". */
  rotuloDoDocumento: string;
  /** E-mail mascarado (`maskEmail`), ou o do cadastro. */
  email: string | null;
  /** Telefone mascarado (`maskPhone`). */
  telefone: string | null;
  /**
   * O titular TEM documento no cadastro e ele não foi reimpresso aqui (campo
   * cifrado em repouso: `contacts.cpf_encrypted`). É ESTA a frase que o
   * documento imprime — nunca um número inventado.
   */
  documentoNoCadastro: boolean;
}

/** Quem executou, de onde e quando — a evidência que o documento carrega. */
export interface EvidenciaDaExecucao {
  /**
   * O ato humano. `null` quando o pedido foi executado pelo sistema (webhook,
   * retomada do worker): aí `origem` é `automatica` e o documento diz isso, em
   * vez de inventar um responsável que não existiu.
   */
  executor: { user_id: string | null; nome: string; email: string | null; papel: string } | null;
  /** IP do ato que executou. `null` = execução automática, sem ato humano. */
  ip: string | null;
  user_agent: string | null;
  /** Instante ISO 8601 do ato de execução (não o do recebimento). */
  em: string;
  origem: "aprovacao_manual" | "automatica";
}

export interface DadosDoAtestado {
  request_id: string;
  organization_id: string;
  /** Razão social do CONTROLADOR (`organizations.legal_name`). */
  organization_name: string;
  /** CNPJ do controlador, inteiro (dado público de empresa). */
  organization_document: string | null;
  /** Contato do encarregado (`organizations.dpo_email`). */
  organization_email: string | null;
  titular: ParteDoAtestado;
  evidencia: EvidenciaDaExecucao;
  /** Escopo do pedido: o titular, ou a loja inteira. */
  escopo: "contact" | "tenant";
  /** Fuso da organização (`organizations.timezone`), para data e hora locais. */
  fuso: string;
  /** Rótulo e citação vindos do PERFIL do país; `null` = país sem citação revisada. */
  lei_rotulo: string | null;
  lei_citada: string | null;
}

/**
 * O PONTO ÚNICO do mascaramento do documento do titular.
 *
 * `null` quando o número não veio — o documento imprime a frase de ausência, e
 * nunca um documento pela metade. Quem decidir imprimir o número inteiro muda
 * esta função (e assume a decisão de exposição num papel que circula).
 */
export function mascararDocumento(documento: string | null | undefined): string | null {
  return mascaraCpf(documento);
}

/** Chaves por onde um pedido pode declarar o documento do titular. */
const CHAVES_DE_DOCUMENTO = ["cpf", "cnpj", "documento", "document", "tax_id", "cpf_cnpj"] as const;

/** Chaves por onde um pedido pode declarar o nome/razão do titular. */
const CHAVES_DE_NOME = ["nome", "name", "razao_social", "razao", "full_name", "display_name"] as const;

function textoDe(payload: Record<string, unknown> | null | undefined, chaves: readonly string[]): string | null {
  if (!payload) return null;
  for (const chave of chaves) {
    const valor = payload[chave];
    if (typeof valor === "string" && valor.trim() !== "") return valor.trim();
  }
  return null;
}

/**
 * O documento do titular, mascarado, pelo que o PEDIDO declarou.
 *
 * O caminho preferido é a declaração do próprio titular no formulário do
 * pedido; o cadastro do contato é o segundo. O CPF do cadastro vive cifrado
 * (`contacts.cpf_encrypted`) e NÃO é decifrado aqui: o pagamento de decifrar
 * PII para reimprimir PII num papel que circula não se paga — o documento
 * declara que o titular tem o dado no cadastro e que ele foi apagado, que é o
 * fato que o atestado prova.
 */
export function documentoDoTitular(payload: Record<string, unknown> | null | undefined): {
  documento: string | null;
  rotuloDoDocumento: string;
} {
  const bruto = textoDe(payload, CHAVES_DE_DOCUMENTO);
  const mascarado = mascararDocumento(bruto);
  if (!mascarado) return { documento: null, rotuloDoDocumento: "Documento" };
  const digitos = (bruto ?? "").replace(/\D/g, "");
  return { documento: mascarado, rotuloDoDocumento: digitos.length === 14 ? "CNPJ" : "CPF" };
}

/**
 * A identidade do titular como o documento a declara.
 *
 * `nomeDoContato`/`emailDoContato`/`telefoneDoContato` têm de ser lidos ANTES da
 * cascata (ela zera esses campos — são justamente os dados apagados); o payload
 * do pedido serve de segundo caminho, como no aviso. O nome nunca fica vazio no
 * papel: sem nome em lugar nenhum, o documento diz "não informado", que é
 * verdade, em vez de deixar a linha em branco (que parece falha de impressão).
 */
function documentoDosCamposCustomizados(campos: Record<string, unknown> | null | undefined): string | null {
  if (!campos) return null;
  const candidatos = new Set(
    Object.entries(campos)
      .filter(([chave]) => chave.toLowerCase().includes("cpf"))
      .map(([, valor]) => (typeof valor === "number" ? String(valor) : valor))
      .filter((valor): valor is string => typeof valor === "string" && mascaraCpf(valor) !== null)
      .map((valor) => valor.replace(/\D/g, "")),
  );
  const [unico] = candidatos;
  // Duas máscaras diferentes = não há como saber qual é a do titular (o `cpf` e
  // o `cpf_responsavel` de uma clínica). Imprimir a errada num papel de
  // exclusão é pior que não imprimir dígito nenhum.
  return candidatos.size === 1 ? mascaraCpf(unico) : null;
}

export function titularDoAtestado(args: {
  payload: Record<string, unknown> | null | undefined;
  /** `contacts.custom_fields`: o segundo lugar onde o documento declarado mora. */
  camposCustomizados?: Record<string, unknown> | null;
  nomeDoContato: string | null;
  emailDoContato: string | null;
  telefoneDoContato: string | null;
  temDocumentoNoCadastro: boolean;
}): ParteDoAtestado {
  const doPayload = documentoDoTitular(args.payload);
  const dosCampos = args.camposCustomizados ? documentoDosCamposCustomizados(args.camposCustomizados) : null;
  const documento = doPayload.documento ?? dosCampos;
  const email = args.emailDoContato ?? textoDe(args.payload, ["email", "e-mail"]);
  const telefone = args.telefoneDoContato ?? textoDe(args.payload, ["telefone", "phone", "celular", "whatsapp"]);
  const nome = args.nomeDoContato ?? textoDe(args.payload, CHAVES_DE_NOME);
  return {
    nome: nome ?? "não informado",
    documento,
    rotuloDoDocumento: doPayload.documento ? doPayload.rotuloDoDocumento : "CPF",
    email: maskEmail(email),
    telefone: maskPhone(telefone),
    documentoNoCadastro: args.temDocumentoNoCadastro && documento === null,
  };
}

/**
 * A linha canônica — o que o código assina.
 *
 * Ordem fixa, separador `|`, campo ausente vira `-` (nunca string vazia: vazio e
 * ausente não podem gerar o mesmo código). É esta função que um auditor
 * reproduz para reconferir; mudar a ordem, o separador ou a versão muda todos
 * os códigos já emitidos — por isso `VERSAO_DO_ATESTADO` vem primeiro.
 */
export function linhaCanonica(d: DadosDoAtestado): string {
  return [
    VERSAO_DO_ATESTADO,
    d.request_id,
    d.organization_id,
    d.organization_name,
    d.organization_document ?? "-",
    d.titular.nome,
    d.titular.documento ?? "-",
    d.titular.rotuloDoDocumento,
    d.titular.email ?? "-",
    d.titular.telefone ?? "-",
    d.escopo,
    d.evidencia.origem,
    d.evidencia.executor?.nome ?? "sistema",
    d.evidencia.executor?.email ?? "-",
    d.evidencia.executor?.papel ?? "-",
    d.evidencia.ip ?? "-",
    d.evidencia.em,
  ].join("|");
}

export type AlgoritmoDoCodigo = "hmac-sha256" | "sha256";

/**
 * O código de autenticidade (HMAC-SHA256) e o algoritmo que de fato o produziu.
 *
 * Sem `LGPD_SIGNING_KEY` o código degrada para SHA-256 da mesma linha: continua
 * provando que os campos não foram editados, mas NÃO prova origem (qualquer um
 * recalcula). Os dois casos são distinguidos no valor devolvido e no rótulo
 * impresso — um selo que afirmasse autenticidade sem chave seria mentira.
 */
export function codigoDeAutenticidade(
  d: DadosDoAtestado,
  chave: string | null | undefined,
): { codigo: string; algoritmo: AlgoritmoDoCodigo } {
  const linha = linhaCanonica(d);
  const segredo = (chave ?? "").trim();
  if (segredo.length > 10) {
    return {
      codigo: createHmac("sha256", segredo).update(linha).digest("hex"),
      algoritmo: "hmac-sha256",
    };
  }
  return { codigo: createHash("sha256").update(linha).digest("hex"), algoritmo: "sha256" };
}

/**
 * O código como ele é CITADO no papel e ao telefone: 16 hex em quatro blocos.
 *
 * O valor completo (64 hex) continua no arquivo e na trilha; este é o recorte
 * legível — quem liga citando o atestado lê o bloco, não uma linha de 64.
 */
export function codigoCurto(codigo: string): string {
  const limpo = codigo.replace(/[^0-9a-f]/gi, "").toUpperCase().slice(0, 16);
  return (limpo.match(/.{1,4}/g) ?? []).join("-");
}

/**
 * A DECLARAÇÃO — o parágrafo que o documento imprime.
 *
 * Texto de FATO, sem artigo: quem foi o pedido, o que foi feito, quando, por
 * quem e de onde. A norma aplicável entra pela citação do perfil do país, no
 * cabeçalho do documento — nunca inventada aqui.
 */
export function textoDaDeclaracao(d: DadosDoAtestado): string {
  const titular = d.titular.nome === "não informado" ? "o titular identificado neste documento" : d.titular.nome;
  const escopo =
    d.escopo === "tenant"
      ? "os dados pessoais de todos os titulares da base desta organização"
      : "os dados pessoais do titular identificado neste documento";
  const executor = d.evidencia.executor
    ? `${d.evidencia.executor.nome}${d.evidencia.executor.email ? ` (${d.evidencia.executor.email})` : ""}`
    : "execução automática do sistema";
  const origem = d.evidencia.ip ? `, a partir do IP ${d.evidencia.ip}` : ", sem ato humano de origem (execução automática)";
  return [
    `Declaramos, na condição de controlador, que em cumprimento ao pedido de exclusão protocolado sob o número ${d.request_id},`,
    `${escopo} — referentes a ${titular} — foram ANONIMIZADOS nos sistemas desta organização,`,
    `com a eliminação dos campos identificáveis, em ${d.evidencia.em}, por ${executor}${origem}.`,
    "O registro desta execução é mantido em trilha de auditoria imutável para demonstração, e este documento é a prova",
    "que o requerente pode guardar. O código de autenticidade abaixo amarra este conjunto de informações ao registro.",
  ].join(" ");
}

/**
 * A evidência de execução, como o pedido a guardou (`request_payload.execucao`).
 *
 * Quem grava é o ATO humano (a rota de aprovação, que tem o IP e o usuário da
 * requisição). Sem isso, o pedido foi executado pelo sistema — webhook, cron ou
 * retomada do worker —, e o documento diz exatamente isso, com o instante da
 * execução: atestado que inventa um responsável é pior que atestado que declara
 * execução automática, porque o primeiro é falso e o segundo é verificável.
 *
 * O que chega aqui vem de JSONB (portanto `unknown`): os campos são conferidos
 * um a um, e nada é copiado sem ser string/`null` — um payload adulterado não
 * vira linha do documento.
 */
export function evidenciaDoPedido(
  execucaoGravada: unknown,
  instanteDaExecucao: string,
): EvidenciaDaExecucao {
  const bruto = execucaoGravada as
    | { origem?: unknown; executor?: { user_id?: unknown; nome?: unknown; email?: unknown; papel?: unknown } | null; ip?: unknown; user_agent?: unknown; em?: unknown }
    | null
    | undefined;
  const executante = bruto && typeof bruto === "object" ? bruto.executor : null;
  const nome = executante && typeof executante.nome === "string" && executante.nome.trim() !== "" ? executante.nome : null;
  if (bruto && typeof bruto === "object" && bruto.origem === "aprovacao_manual" && nome) {
    return {
      executor: {
        user_id: typeof executante?.user_id === "string" ? executante.user_id : null,
        nome,
        email: typeof executante?.email === "string" ? executante.email : null,
        papel: typeof executante?.papel === "string" ? executante.papel : "administrador",
      },
      ip: typeof bruto.ip === "string" ? bruto.ip : null,
      user_agent: typeof bruto.user_agent === "string" ? bruto.user_agent : null,
      em: typeof bruto.em === "string" ? bruto.em : instanteDaExecucao,
      origem: "aprovacao_manual",
    };
  }
  return { executor: null, ip: null, user_agent: null, em: instanteDaExecucao, origem: "automatica" };
}
