export type Passage = {
  id: string;
  text: string;
};

/**
 * Built-in passages, in Brazilian Portuguese.
 *
 * Written for this project instead of quoted from books, so there is nothing to license and
 * no external API to depend on. Accents and punctuation are kept because typing them is part
 * of the exercise, but there are no line breaks or typographic quotes: they are awkward to
 * type and would mostly measure who knows the keyboard shortcut.
 */
export const PASSAGES: readonly Passage[] = [
  {
    id: "cafe",
    text: "O cafe da manha estava frio, mas ninguem reclamou. A conversa era boa demais para ser interrompida por causa de uma xicara.",
  },
  {
    id: "chuva",
    text: "Choveu a noite inteira. De manha, a rua estava limpa e o cheiro de terra molhada subia pelas janelas abertas.",
  },
  {
    id: "onibus",
    text: "O onibus atrasou vinte minutos. Quando chegou, ja nao havia mais pressa em ninguem que esperava no ponto.",
  },
  {
    id: "teclado",
    text: "Digitar rapido nao e so mover os dedos. E antecipar a proxima palavra antes que os olhos terminem de ler a linha anterior.",
  },
  {
    id: "praia",
    text: "A praia estava vazia naquela terca-feira de maio. O mar parecia maior sem gente para dividir o horizonte.",
  },
  {
    id: "livraria",
    text: "Entrou na livraria para fugir do sol e saiu de la duas horas depois com tres livros que nao tinha planejado comprar.",
  },
  {
    id: "musica",
    text: "A musica tocou de novo no radio do carro e, por alguns segundos, ele lembrou exatamente onde estava quando ouviu pela primeira vez.",
  },
  {
    id: "mudanca",
    text: "Guardou tudo em caixas numeradas. Na hora de abrir, descobriu que os numeros nao ajudavam em nada.",
  },
  {
    id: "codigo",
    text: "Todo codigo simples ja foi complicado antes. Alguem sentou, entendeu o problema de verdade e apagou metade do que tinha escrito.",
  },
  {
    id: "feira",
    text: "Na feira de domingo, o vendedor de mangas gritava o preco como quem canta. As frutas acabaram antes do meio-dia.",
  },
  {
    id: "cachorro",
    text: "O cachorro aprendeu o barulho da chave na porta antes de aprender o proprio nome, e nunca errou uma vez sequer.",
  },
  {
    id: "estrada",
    text: "A estrada seguia reta por quilometros. De vez em quando aparecia um posto, uma placa torta e o mesmo horizonte de novo.",
  },
  {
    id: "silencio",
    text: "Existe um tipo de silencio que so acontece em biblioteca. Nao e ausencia de som, e um monte de gente concordando em nao fazer barulho.",
  },
  {
    id: "receita",
    text: "A receita dizia trinta minutos. Levou duas horas, sujou seis panelas e ficou boa o suficiente para valer a pena repetir no sabado seguinte.",
  },
  {
    id: "trem",
    text: "O trem passa as seis e dez todos os dias. Quem mora perto ja nem escuta mais, mas os visitantes sempre param de falar quando ele passa.",
  },
  {
    id: "inverno",
    text: "O inverno aqui dura pouco e mesmo assim todo mundo reclama. Em julho, quem tem casaco no armario faz questao de usar.",
  },
  {
    id: "prazo",
    text: "O prazo era sexta. Na quarta ainda parecia longe, na quinta a noite ja era ontem, e na sexta de manha tudo ficou surpreendentemente claro.",
  },
  {
    id: "vizinho",
    text: "O vizinho de cima anda de um lado para o outro toda madrugada. Depois de um ano, virou parte do som normal da casa.",
  },
  {
    id: "bicicleta",
    text: "Andar de bicicleta na cidade e negociar espaco o tempo todo. Voce aprende a ler o transito pelo som antes de enxergar o carro.",
  },
  {
    id: "domingo",
    text: "Domingo a tarde tem uma luz especifica, meio laranja, que nenhum outro dia da semana consegue imitar direito.",
  },
];
