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
 * Duas decisões do doc 110 (o dono respondeu "1A, 2A, 3A"):
 *
 * - 1A: das ações da IA (`ai_agent_runs`) fica a LISTA do que ela fez — o nome
 *   de cada ação e quando rodou — e sai o que ela digitou em cada uma. O termo
 *   de uma busca de contato pode ser o nome ou o telefone de OUTRO cliente
 *   (`lib/mcp/tools/contacts.ts`), e a razão de chamar um atendente
 *   (`lib/mcp/tools/handoff.ts`) é texto escrito PARA a equipe. Por lista de
 *   permissão, não de proibição: ação nova da IA nasce sem argumento no
 *   arquivo. Revê o #1965 só nesse ponto. Vale para todo país.
 * - 3A: em Portugal, as seis notas que a equipe escreve SOBRE o titular voltam
 *   ao arquivo, com o texto e a data e sem o nome de quem escreveu
 *   (`NOTAS_SOBRE_O_TITULAR`). Pelo RGPD a opinião registrada sobre a pessoa é
 *   dado dela (TJUE, Nowak, 2017), e o art. 15.º, n.º 4 só autoriza proteger
 *   OUTRAS pessoas — o funcionário, não o texto. O Brasil segue sem elas
 *   (doc 103, A). Leitura do mantenedor, não parecer jurídico.
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
import type { OrigemDaPassagem } from "@/lib/escalacao/passagem";
import type { ExportPayload } from "@/lib/lgpd/export-collector";

/** Seções que não vão no arquivo. */
export const SECOES_DA_EQUIPE = {
  conversation_notes:
    "nota interna: o que a equipe anotou para a equipe na conversa, com o nome de quem escreveu e o caminho do anexo no armazenamento (em Portugal, o texto e a data voltam: `NOTAS_SOBRE_O_TITULAR`)",
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
  messages_completas: "todas as mensagens dele, sem o recorte de 100 (doc 110, 2A: também no Brasil)",
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
    "a passagem do atendimento dele a uma pessoa: o pedido em uma linha, o que a IA já tentou, as últimas palavras dele e o motivo",
  avisos_de_caso: "que a equipe foi avisada do caso dele, e quando",
  campaign_recipients: "as mensagens de campanha que ele recebeu, e por que foi ou não incluído",
  campaign_suppressions: "a exclusão dele das campanhas",
  channel_session_groups: "os grupos de WhatsApp ligados a ele",
  group_messages_authored: "o que ele escreveu em grupos",
  conversation_drafts: "o texto escrito PARA ele por outro sistema",
  contact_field_proposals: "o dado dele que a IA ouviu na conversa e propôs gravar, e o que se decidiu",
  lead_notes: "a memória que a IA guarda sobre ele (LGPD art. 20)",
  ai_agent_runs:
    "o que a IA fez na conversa com ele e quando: o nome de cada ação, sem o que ela digitou (#1965, revisto no doc 110, 1A)",
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
  activities: { source_module: "telemetria: qual módulo do sistema registrou a atividade" },
  appointments: {
    google_base_projection: "estado da sincronização com o Google Agenda",
    google_conflict: "estado da sincronização com o Google Agenda",
    google_pending_write: "estado da sincronização com o Google Agenda",
    meeting_state: "estado interno da criação do link da reunião (o link em si fica)",
  },
  case_events: {
    metadata: "metadado do motor do caso: guarda o telefone (mascarado) do plantão avisado e chaves internas",
  },
  passagens: {
    motor: "qual dos dois motores do sistema passou a conversa",
    origem: "o caminho de código por onde a passagem entrou (o motivo, `motivo_codigo`, fica)",
    body:
      "a narrativa montada PARA quem vai atender (`montarBriefingDaPassagem`): repete entre aspas o texto livre de quem passou — o `por_que` da IA (doc 110, 1A) e a razão de quem escalou — e o resto já vai em `title`, `notes`, `tentativas` e `motivo_codigo`",
  },
  avisos_de_caso: {
    destino_mascarado: "telefone, mesmo mascarado, do FUNCIONÁRIO avisado: dado de terceiro",
    erro_codigo: "código de erro da entrega do aviso à equipe",
    tentativas: "contagem de reenvio do aviso à equipe",
  },
  prospecting_candidates: { error: "mensagem de erro interna da abordagem" },
  "b2b.linhas_importadas": { error: "erro interno da importação da planilha" },
};

/**
 * As notas que a equipe escreve SOBRE o titular (doc 110, 3A). Saem no Brasil
 * (doc 103, A); em Portugal ficam — ver o cabeçalho. Além destes campos, são
 * notas sobre ele a seção `conversation_notes` (em Portugal só `body` e
 * `created_at`) e o `body` de `case_events` com ator humano.
 */
export const NOTAS_SOBRE_O_TITULAR: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sales: { notes: "anotação que o atendente escreveu na comanda" },
  "b2b.pessoa": { notes: "anotação da equipe sobre a pessoa na base de empresas" },
  "b2b.vinculos": { notes: "anotação da equipe sobre o vínculo com a empresa" },
  contact_field_proposals: { motivo_recusa: "por que a equipe recusou a proposta de gravar um dado dele" },
  passagens: {
    content:
      "a razão que a pessoa da equipe escreveu ao escalar o caso (origem `caso_escalado`). Nas outras origens o campo é o `por_que` da IA ou o `reason` de um agente MCP — texto da máquina para a equipe, que sai em todo país (doc 110, 1A)",
  },
};

/**
 * Os países em que as notas sobre o titular vão no arquivo (doc 110, 3A). O
 * dono decidiu Portugal; país novo entra aqui por decisão, não por herança.
 */
const PAISES_QUE_RECEBEM_AS_NOTAS = new Set(["PT"]);

/** A única origem de passagem cujo `content` uma pessoa da equipe escreveu (`app/api/v1/ai/cases/[id]/reply`). */
const ORIGEM_ESCRITA_PELA_EQUIPE: OrigemDaPassagem = "caso_escalado";

/** As chaves de banco que ficam, e por quê — ver o item 1 do cabeçalho. */
const CHAVES_QUE_FICAM = new Set(["external_id"]);

const ehChaveDeBanco = (campo: string) =>
  !CHAVES_QUE_FICAM.has(campo) && (campo === "id" || campo.endsWith("_id"));

type Objeto = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);

/** As linhas de uma seção: os itens da lista, ou o próprio objeto. */
const linhasDe = (v: unknown): Objeto[] =>
  Array.isArray(v) ? v.filter(ehObjeto) : ehObjeto(v) ? [v] : [];

/**
 * As ações da IA sem o que ela digitou (doc 110, 1A): da forma de
 * `toolCallsParaOTitular` (passo → chamadas → args) ficam só `step`,
 * `tool_name` e `redacted`, por LISTA DE PERMISSÃO — campo novo não passa.
 */
function soOQueAIaFez(toolCalls: unknown): unknown[] {
  return linhasDe(toolCalls).map((passo) => ({
    ...(passo.step !== undefined ? { step: passo.step } : {}),
    ...(typeof passo.tool_name === "string" ? { tool_name: passo.tool_name } : {}),
    ...(passo.redacted === true ? { redacted: true } : {}),
    tool_calls: linhasDe(passo.tool_calls).map((c) => ({
      tool_name: typeof c.tool_name === "string" ? c.tool_name : "unknown",
    })),
  }));
}

function semCampos(copia: Objeto, mapa: Readonly<Record<string, Readonly<Record<string, string>>>>) {
  for (const [caminho, campos] of Object.entries(mapa)) {
    const [raiz, filho] = caminho.split(".") as [string, string | undefined];
    const topo = copia[raiz];
    const valor = filho === undefined ? topo : ehObjeto(topo) ? topo[filho] : undefined;
    for (const linha of linhasDe(valor)) for (const campo of Object.keys(campos)) delete linha[campo];
  }
}

/**
 * O `data.json` do titular, para o país da organização (`perfil.codigo`, a
 * mesma leitura única do worker). Não altera `data` — o PDF é desenhado a
 * partir dele. A chave de banco sai do NÍVEL DA LINHA: dentro de um `jsonb` do
 * titular (campos personalizados, origem do anúncio) um `pedido_id` é dado
 * dele, e fica. Os argumentos das ações da IA, onde moravam `owner_user_id`,
 * `target_user_id` e `lead_id`, saem inteiros (doc 110, 1A).
 *
 * No caso, o `body` de evento com ator humano (`human_replied`) é a nota de
 * quem resolveu, o motivo de quem escalou ou o pedido de quem precisou de mais
 * informação (`lib/agent-engine/agent/human-cases.ts`): nota da equipe sobre
 * ele, que segue `NOTAS_SOBRE_O_TITULAR`. O `body` que a IA ou ele escreveu fica.
 */
export function copiaDoTitular(data: ExportPayload, pais: string): Objeto {
  const copia = JSON.parse(JSON.stringify(data)) as Objeto;
  const recebeAsNotas = PAISES_QUE_RECEBEM_AS_NOTAS.has(pais);

  for (const secao of Object.keys(SECOES_DA_EQUIPE)) delete copia[secao];
  // Antes de `origem` sair: só a passagem de um caso escalado tem `content`
  // escrito por uma pessoa da equipe (0291).
  for (const p of linhasDe(copia.passagens)) if (p.origem !== ORIGEM_ESCRITA_PELA_EQUIPE) delete p.content;
  // O anexo fica fora: o arquivo levaria só o caminho interno no armazenamento.
  if (recebeAsNotas && data.conversation_notes)
    copia.conversation_notes = data.conversation_notes.map(({ body, created_at }) => ({ body, created_at }));

  semCampos(copia, CAMPOS_DA_EQUIPE);
  if (!recebeAsNotas) {
    semCampos(copia, NOTAS_SOBRE_O_TITULAR);
    for (const evento of linhasDe(copia.case_events)) if (evento.actor_kind === "human") delete evento.body;
  }

  for (const run of linhasDe(copia.ai_agent_runs)) run.tool_calls = soOQueAIaFez(run.tool_calls);

  for (const [secao, valor] of Object.entries(copia)) {
    // `b2b` é a única seção que agrupa outras (pessoa, vínculos, linhas).
    const linhas = secao === "b2b" && ehObjeto(valor) ? Object.values(valor).flatMap(linhasDe) : linhasDe(valor);
    for (const linha of linhas) for (const campo of Object.keys(linha)) if (ehChaveDeBanco(campo)) delete linha[campo];
  }

  return copia;
}
