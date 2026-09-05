package race

// Passage is one built-in text, in Brazilian Portuguese.
//
// They were written for this project instead of quoted from books, so there is nothing to
// license and no external API to depend on.
//
// They are spelled in correct Portuguese, accents and all, and the easier variants are derived
// from this text rather than the other way round. Stripping an accent is mechanical; putting
// one back is a judgement call, and a source text spelled wrong would teach everyone who plays
// to type it wrong.
//
// No line breaks and no typographic quotes: both are awkward to type and would mostly measure
// who knows the keyboard shortcut.
type Passage struct {
	ID   string
	Text string
}

var passages = []Passage{
	{ID: "cafe", Text: "O café da manhã estava frio, mas ninguém reclamou. A conversa era boa demais para ser interrompida por causa de uma xícara."},
	{ID: "chuva", Text: "Choveu a noite inteira. De manhã, a rua estava limpa e o cheiro de terra molhada subia pelas janelas abertas."},
	{ID: "onibus", Text: "O ônibus atrasou vinte minutos. Quando chegou, já não havia mais pressa em ninguém que esperava no ponto."},
	{ID: "teclado", Text: "Digitar rápido não é só mover os dedos. É antecipar a próxima palavra antes que os olhos terminem de ler a linha anterior."},
	{ID: "praia", Text: "A praia estava vazia naquela terça-feira de maio. O mar parecia maior sem gente para dividir o horizonte."},
	{ID: "livraria", Text: "Entrou na livraria para fugir do sol e saiu de lá duas horas depois com três livros que não tinha planejado comprar."},
	{ID: "musica", Text: "A música tocou de novo no rádio do carro e, por alguns segundos, ele lembrou exatamente onde estava quando ouviu pela primeira vez."},
	{ID: "mudanca", Text: "Guardou tudo em caixas numeradas. Na hora de abrir, descobriu que os números não ajudavam em nada."},
	{ID: "codigo", Text: "Todo código simples já foi complicado antes. Alguém sentou, entendeu o problema de verdade e apagou metade do que tinha escrito."},
	{ID: "feira", Text: "Na feira de domingo, o vendedor de mangas gritava o preço como quem canta. As frutas acabaram antes do meio-dia."},
	{ID: "cachorro", Text: "O cachorro aprendeu o barulho da chave na porta antes de aprender o próprio nome, e nunca errou uma vez sequer."},
	{ID: "estrada", Text: "A estrada seguia reta por quilômetros. De vez em quando aparecia um posto, uma placa torta e o mesmo horizonte de novo."},
	{ID: "silencio", Text: "Existe um tipo de silêncio que só acontece em biblioteca. Não é ausência de som, é um monte de gente concordando em não fazer barulho."},
	{ID: "receita", Text: "A receita dizia trinta minutos. Levou duas horas, sujou seis panelas e ficou boa o suficiente para valer a pena repetir no sábado seguinte."},
	{ID: "trem", Text: "O trem passa às seis e dez todos os dias. Quem mora perto já nem escuta mais, mas os visitantes sempre param de falar quando ele passa."},
	{ID: "inverno", Text: "O inverno aqui dura pouco e mesmo assim todo mundo reclama. Em julho, quem tem casaco no armário faz questão de usar."},
	{ID: "prazo", Text: "O prazo era sexta. Na quarta ainda parecia longe, na quinta à noite já era ontem, e na sexta de manhã tudo ficou surpreendentemente claro."},
	{ID: "vizinho", Text: "O vizinho de cima anda de um lado para o outro toda madrugada. Depois de um ano, virou parte do som normal da casa."},
	{ID: "bicicleta", Text: "Andar de bicicleta na cidade é negociar espaço o tempo todo. Você aprende a ler o trânsito pelo som antes de enxergar o carro."},
	{ID: "domingo", Text: "Domingo à tarde tem uma luz específica, meio laranja, que nenhum outro dia da semana consegue imitar direito."},
}
