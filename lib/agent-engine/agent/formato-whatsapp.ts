/**
 * O TEXTO DO MODELO NO FORMATO QUE O WHATSAPP ENTENDE.
 *
 * Dois defeitos medidos em conversas reais (26/09/2026, Claude Haiku 4.5, atendimento em espanhol):
 *
 *   1. às vezes o modelo escreve o salto de linha ESCAPADO — os caracteres
 *      `\` e `n` — e o cliente lê "Tómate tu tiempo.\n\nCualquier duda…";
 *   2. o modelo usa negrito de Markdown (`**texto**`), mas o WhatsApp usa
 *      `*texto*`: os asteriscos duplos aparecem na tela do cliente.
 *
 * Pura: sem I/O. Aplicada no `send_message` antes de qualquer gate, para que o
 * que se mede (pausa humana, spinning, bolhas) seja o que o cliente recebe.
 */
export function formatarParaWhatsApp(texto: string): string {
  let t = texto;

  // 1. Saltos de linha escapados viram saltos de verdade.
  t = t.replace(/\\r\\n|\\n|\\r/g, '\n');

  // 2. Markdown → WhatsApp.
  t = t.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '*$1*'); // **negrito** → *negrito*
  t = t.replace(/__(?=\S)([^_\n]+?)__/g, '_$1_'); // __itálico__ → _itálico_
  t = t.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, '*$1*'); // "## Título" → *Título*

  // 3. Espaços no fim da linha e mais de uma linha em branco seguida.
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}
