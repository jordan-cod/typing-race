export type Passage = {
  id: string;
  text: string;
};

/**
 * Built-in passages, in Brazilian Portuguese.
 *
 * Written for this project instead of quoted from books, so there is nothing to license and
 * no external API to depend on.
 *
 * They are written in correct Portuguese, accents and all, and the easier variants are derived
 * from this text rather than the other way round. Stripping an accent is mechanical; putting
 * one back is a judgement call, and a source text spelled wrong would teach everyone who plays
 * to type it wrong.
 *
 * No line breaks and no typographic quotes: both are awkward to type and would mostly measure
 * who knows the keyboard shortcut.
 */
export const PASSAGES: readonly Passage[] = [
  {
    id: "cafe",
    text: "O café da manhã estava frio, mas ninguém reclamou. A conversa era boa demais para ser interrompida por causa de uma xícara.",
  },
  {
    id: "chuva",
    text: "Choveu a noite inteira. De manhã, a rua estava limpa e o cheiro de terra molhada subia pelas janelas abertas.",
  },
  {
    id: "onibus",
    text: "O ônibus atrasou vinte minutos. Quando chegou, já não havia mais pressa em ninguém que esperava no ponto.",
  },
  {
    id: "teclado",
    text: "Digitar rápido não é só mover os dedos. É antecipar a próxima palavra antes que os olhos terminem de ler a linha anterior.",
  },
  {
    id: "praia",
    text: "A praia estava vazia naquela terça-feira de maio. O mar parecia maior sem gente para dividir o horizonte.",
  },
  {
    id: "livraria",
    text: "Entrou na livraria para fugir do sol e saiu de lá duas horas depois com três livros que não tinha planejado comprar.",
  },
  {
    id: "musica",
    text: "A música tocou de novo no rádio do carro e, por alguns segundos, ele lembrou exatamente onde estava quando ouviu pela primeira vez.",
  },
  {
    id: "mudanca",
    text: "Guardou tudo em caixas numeradas. Na hora de abrir, descobriu que os números não ajudavam em nada.",
  },
  {
    id: "codigo",
    text: "Todo código simples já foi complicado antes. Alguém sentou, entendeu o problema de verdade e apagou metade do que tinha escrito.",
  },
  {
    id: "feira",
    text: "Na feira de domingo, o vendedor de mangas gritava o preço como quem canta. As frutas acabaram antes do meio-dia.",
  },
  {
    id: "cachorro",
    text: "O cachorro aprendeu o barulho da chave na porta antes de aprender o próprio nome, e nunca errou uma vez sequer.",
  },
  {
    id: "estrada",
    text: "A estrada seguia reta por quilômetros. De vez em quando aparecia um posto, uma placa torta e o mesmo horizonte de novo.",
  },
  {
    id: "silencio",
    text: "Existe um tipo de silêncio que só acontece em biblioteca. Não é ausência de som, é um monte de gente concordando em não fazer barulho.",
  },
  {
    id: "receita",
    text: "A receita dizia trinta minutos. Levou duas horas, sujou seis panelas e ficou boa o suficiente para valer a pena repetir no sábado seguinte.",
  },
  {
    id: "trem",
    text: "O trem passa às seis e dez todos os dias. Quem mora perto já nem escuta mais, mas os visitantes sempre param de falar quando ele passa.",
  },
  {
    id: "inverno",
    text: "O inverno aqui dura pouco e mesmo assim todo mundo reclama. Em julho, quem tem casaco no armário faz questão de usar.",
  },
  {
    id: "prazo",
    text: "O prazo era sexta. Na quarta ainda parecia longe, na quinta à noite já era ontem, e na sexta de manhã tudo ficou surpreendentemente claro.",
  },
  {
    id: "vizinho",
    text: "O vizinho de cima anda de um lado para o outro toda madrugada. Depois de um ano, virou parte do som normal da casa.",
  },
  {
    id: "bicicleta",
    text: "Andar de bicicleta na cidade é negociar espaço o tempo todo. Você aprende a ler o trânsito pelo som antes de enxergar o carro.",
  },
  {
    id: "domingo",
    text: "Domingo à tarde tem uma luz específica, meio laranja, que nenhum outro dia da semana consegue imitar direito.",
  },
];
