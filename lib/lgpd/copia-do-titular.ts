/**
 * A CÓPIA QUE O TITULAR RECEBE — o `data.json` que vai por link no e-mail de
 * acesso, no Brasil e fora dele (doc 103, resposta A; Portugal desde o #2354).
 *
 * O coletor (`collectExportData`) monta o payload INTEIRO, e é dele que sai o
 * PDF — que não muda com isto. O arquivo entregue é esta projeção: o mesmo
 * payload sem o que é da EQUIPE e não do titular. Três categorias saem, e só
 * elas; cada linha abaixo diz por quê.
 *
 * 1. Chave de banco (`id` e `*_id` de cada linha). Não identifica nada para quem
 *    lê, e é o mapa interno do sistema. Ficam: `external_id` do pedido (o número
 *    que a loja mostrou ao cliente) e o envelope — `request_id` é o protocolo do
 *    pedido dele (o e-mail cita o começo) e `organization_id` é o "ID interno"
 *    que o PDF já imprime para o suporte.
 * 2. Nota da equipe e dado de funcionário: o texto que a equipe escreveu PARA a
 *    equipe, e o nome ou telefone de quem trabalha lá (dado de terceiro).
 * 3. Encanamento: estado de sincronização, código de motor, erro interno,
 *    contagem de reenvio — metadado que não diz nada sobre a pessoa.
 *
 * TODA seção do payload está classificada em `O_QUE_FICA` ou em
 * `SECOES_DA_EQUIPE`, com o motivo: o `satisfies` faz uma seção nova no
 * `ExportPayload` não compilar até alguém decidir se ela vai ao titular, e
 * `tests/unit/lgpd-copia-do-titular.test.ts` cobra o mesmo do payload que o
 * coletor devolve.
 *
 * Saem campos inteiros, nunca trechos de texto: o que fica, fica como foi
 * coletado. Campo que o PDF já imprime NÃO entra nesta lista (`appointments.notes`,
 * `reply_drafts.feedback`): o PDF não muda, e tirar do arquivo o que o relatório
 * entrega não protegeria nada.
 */
import type { ExportPayload } from "@/lib/lgpd/export-collector";

/** Seções que não vão no arquivo. */
export const SECOES_DA_EQUIPE = {
  conversation_notes:
    "nota interna: o que a equipe anotou para a equipe na conversa, com o nome de quem escreveu e o caminho do anexo no armazenamento",
  case_chat_messages: "a conversa interna da equipe com a IA sobre o caso",
  appointment_notices:
    "aviso da Central PARA a equipe sobre o compromisso (registrar desfecho, revisar recuperação): tarefa interna, não dado dele",
} as const satisfies Partial<Record<keyof ExportPayload, string>>;

/**
 * As seções que vão ao titular, e por quê. Seção com campos em
 * `CAMPOS_DA_EQUIPE` vai sem eles.
 */
export const O_QUE_FICA = {
  request_id: "o protocolo do pedido dele (o e-mail cita o começo)",
  organization_id: "o \"ID interno\" que o PDF já imprime para o suporte",
  organization_legal_name: "o controlador: quem responde pelos dados",
  organization_display_name: "o nome com que o controlador se apresenta a ele",
  dpo_email: "o encarregado a quem ele se dirige",
  lei_citada: "a lei que fundamenta a resposta",
  lei_rotulo: "o rótulo dessa lei no país dele",
  fuso: "o fuso das datas do documento",
  art15: "as informações do art. 15.º do RGPD devidas a ele",
  messages_completas: "todas as mensagens dele (fora do Brasil)",
  secoes_no_limite: "a ressalva de que pode haver mais registros do que os entregues",
  documento_rotulo: "o nome do documento dele no país (\"CPF\")",
  generated_at: "quando a cópia foi gerada",
  no_local_footprint: "se a instalação tem ou não dado dele",
  contact: "a ficha dele, inclusive os campos personalizados e a origem do anúncio",
  consents: "os consentimentos que ele deu ou negou",
  conversations: "as conversas dele: canal, estado e datas",
  messages_count_total: "quantas mensagens ele trocou",
  messages_recent: "as 100 mensagens mais recentes dele",
  leads: "as oportunidades abertas para ele: título, estado e valor",
  honorarios_contratos: "o contrato de honorários dele (sem a divisão interna do escritório)",
  honorarios_parcelas: "as parcelas que ele paga",
  orders: "os pedidos dele na loja",
  activities: "o que foi registrado sobre ele e quando",
  checkpoints: "o resumo que a máquina fez da conversa com ele (LGPD art. 20)",
  appointments: "os compromissos dele, com o link da reunião e a anotação que o PDF já imprime",
  sales: "as compras dele e por que foram canceladas ou estornadas",
  proposals: "as propostas comerciais enviadas a ele",
  tasks: "o que se combinou fazer para ele",
  webhook_captures:
    "o que ele enviou num formulário, com o IP e o navegador de onde enviou: dado dele, origem do contato (art. 19, II)",
  audit_log_extract: "o registro de quem acessou e mudou os dados dele (o PDF já entrega)",
  meeting_deliveries: "o envio do link da reunião a ele, e em que estado ficou",
  voice_calls: "as chamadas de voz dele: número, duração e como terminaram",
  prospecting_candidates:
    "o dado público do negócio dele que originou a abordagem (origem dos dados, art. 19, II)",
  cases:
    "o que a IA entendeu do problema dele quando travou (título, resumo, bloqueio): descrição dele por máquina, LGPD art. 20",
  case_events:
    "a linha do tempo do caso dele: o que a IA registrou e o que ele respondeu (sem o texto de quem é da equipe)",
  demandas: "o pedido dele: assunto, estado, se quem cuida é a IA ou uma pessoa, próximo passo e desfecho",
  passagens:
    "a passagem do atendimento dele a uma pessoa: o pedido em uma linha, a narrativa, as últimas palavras dele e o motivo",
  avisos_de_caso: "que a equipe foi avisada do caso dele, e quando",
  campaign_recipients: "as mensagens de campanha que ele recebeu, e por que foi ou não incluído",
  campaign_suppressions: "a exclusão dele das campanhas",
  channel_session_groups: "os grupos de WhatsApp ligados a ele",
  group_messages_authored: "o que ele escreveu em grupos",
  conversation_drafts: "o texto escrito PARA ele por outro sistema",
  contact_field_proposals: "o dado dele que a IA ouviu na conversa e propôs gravar, e o que se decidiu",
  lead_notes: "a memória que a IA guarda sobre ele (LGPD art. 20)",
  ai_agent_runs: "o que a IA fez com o que ele escreveu: nome e argumentos de cada ferramenta (#1965)",
  lead_state: "o próximo passo e a qualificação dele, por máquina (LGPD art. 20)",
  b2b: "a pessoa para quem a ficha dele aponta, os vínculos com empresas e as linhas de planilha sobre ele",
  reply_drafts: "as respostas sugeridas a ele e a revisão (o PDF já entrega)",
} as const;

/** Toda seção do payload decidida: a que falta não compila. */
const _todaSecaoDecidida = { ...O_QUE_FICA, ...SECOES_DA_EQUIPE } satisfies Record<keyof ExportPayload, string>;
void _todaSecaoDecidida;

/** Campos que saem de cada linha da seção (ou do objeto, quando a seção é um só). */
export const CAMPOS_DA_EQUIPE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  honorarios_contratos: {
    repasse_advogado_pct: "quanto o escritório repassa ao advogado: divisão interna, não dado dele",
  },
  meeting_deliveries: { run_after: "quando a fila interna vai tentar de novo" },
  contact_field_proposals: {
    motivo_recusa: "por que a equipe recusou a proposta: nota da equipe para a IA aprender",
  },
  activities: { source_module: "telemetria: qual módulo do sistema registrou a atividade" },
  appointments: {
    google_base_projection: "estado da sincronização com o Google Agenda",
    google_conflict: "estado da sincronização com o Google Agenda",
    google_pending_write: "estado da sincronização com o Google Agenda",
    meeting_state: "estado interno da criação do link da reunião (o link em si fica)",
  },
  sales: { notes: "anotação interna que o atendente escreveu na comanda" },
  case_events: {
    metadata: "metadado do motor do caso: guarda o telefone (mascarado) do plantão avisado e chaves internas",
  },
  passagens: {
    motor: "qual dos dois motores do sistema passou a conversa",
    origem: "o caminho de código por onde a passagem entrou (o motivo, `motivo_codigo`, fica)",
    content:
      "o texto livre de quem passou: a razão que a pessoa da equipe escreveu ao escalar, ou o `por_que` da ferramenta, escrito para a equipe (0291)",
  },
  avisos_de_caso: {
    destino_mascarado: "telefone, mesmo mascarado, do FUNCIONÁRIO avisado: dado de terceiro",
    erro_codigo: "código de erro da entrega do aviso à equipe",
    tentativas: "contagem de reenvio do aviso à equipe",
  },
  prospecting_candidates: { error: "mensagem de erro interna da abordagem" },
  "b2b.pessoa": { notes: "anotação da equipe sobre a pessoa na base de empresas" },
  "b2b.vinculos": { notes: "anotação da equipe sobre o vínculo com a empresa" },
  "b2b.linhas_importadas": { error: "erro interno da importação da planilha" },
};

/** As chaves de banco que ficam, e por quê — ver o item 1 do cabeçalho. */
const CHAVES_QUE_FICAM = new Set(["external_id"]);

const ehChaveDeBanco = (campo: string) =>
  !CHAVES_QUE_FICAM.has(campo) && (campo === "id" || campo.endsWith("_id"));

type Objeto = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);

/** As linhas de uma seção: os itens da lista, ou o próprio objeto. */
const linhasDe = (v: unknown): Objeto[] =>
  Array.isArray(v) ? v.filter(ehObjeto) : ehObjeto(v) ? [v] : [];

/** Tira `id`/`*_id` em qualquer profundidade. */
function semChavesDeBanco(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(semChavesDeBanco);
  if (!ehObjeto(v)) return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([campo]) => !ehChaveDeBanco(campo))
      .map(([campo, valor]) => [campo, semChavesDeBanco(valor)]),
  );
}

/**
 * O `data.json` do titular. Não altera `data` — o PDF é desenhado a partir
 * dele. A chave de banco sai do NÍVEL DA LINHA: dentro de um `jsonb` do
 * titular (campos personalizados, origem do anúncio) um `pedido_id` é dado
 * dele, e fica. A exceção é `ai_agent_runs.tool_calls`, que é jsonb da
 * MÁQUINA: os argumentos das ferramentas levam `owner_user_id`,
 * `target_user_id`, `to_user_id` (o funcionário da agenda, do repasse) e
 * `lead_id`, e ali a chave sai em qualquer profundidade.
 *
 * No caso, o `body` de evento com ator humano (`human_replied`) é a nota de
 * quem resolveu, o motivo de quem escalou ou o pedido de quem precisou de mais
 * informação (`lib/agent-engine/agent/human-cases.ts`): texto da equipe, que
 * sai como `sales.notes`. O `body` que a IA ou ele escreveu fica.
 */
export function copiaDoTitular(data: ExportPayload): Objeto {
  const copia = JSON.parse(JSON.stringify(data)) as Objeto;

  for (const secao of Object.keys(SECOES_DA_EQUIPE)) delete copia[secao];

  for (const [caminho, campos] of Object.entries(CAMPOS_DA_EQUIPE)) {
    const [raiz, filho] = caminho.split(".") as [string, string | undefined];
    const topo = copia[raiz];
    const valor = filho === undefined ? topo : ehObjeto(topo) ? topo[filho] : undefined;
    for (const linha of linhasDe(valor)) for (const campo of Object.keys(campos)) delete linha[campo];
  }

  for (const evento of linhasDe(copia.case_events)) if (evento.actor_kind === "human") delete evento.body;

  for (const run of linhasDe(copia.ai_agent_runs)) run.tool_calls = semChavesDeBanco(run.tool_calls);

  for (const [secao, valor] of Object.entries(copia)) {
    // `b2b` é a única seção que agrupa outras (pessoa, vínculos, linhas).
    const linhas = secao === "b2b" && ehObjeto(valor) ? Object.values(valor).flatMap(linhasDe) : linhasDe(valor);
    for (const linha of linhas) for (const campo of Object.keys(linha)) if (ehChaveDeBanco(campo)) delete linha[campo];
  }

  return copia;
}
