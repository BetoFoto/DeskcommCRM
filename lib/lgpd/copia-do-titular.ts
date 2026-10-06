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
} as const satisfies Partial<Record<keyof ExportPayload, string>>;

/** Campos que saem de cada linha da seção (ou do objeto, quando a seção é um só). */
export const CAMPOS_DA_EQUIPE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
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

/**
 * O `data.json` do titular. Não altera `data` — o PDF é desenhado a partir
 * dele. A chave de banco só sai do NÍVEL DA LINHA: dentro de um `jsonb` do
 * titular (campos personalizados, origem do anúncio) um `pedido_id` é dado
 * dele, e fica.
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

  for (const [secao, valor] of Object.entries(copia)) {
    // `b2b` é a única seção que agrupa outras (pessoa, vínculos, linhas).
    const linhas = secao === "b2b" && ehObjeto(valor) ? Object.values(valor).flatMap(linhasDe) : linhasDe(valor);
    for (const linha of linhas) for (const campo of Object.keys(linha)) if (ehChaveDeBanco(campo)) delete linha[campo];
  }

  return copia;
}
