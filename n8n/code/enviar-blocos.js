// Quebra a resposta em mensagens curtas, como uma pessoa digitando no WhatsApp,
// e calcula pausas humanas: tempo de "ler" antes de começar e tempo de "digitando…" por mensagem.
const MAX_BOLHA = 170;   // caracteres por mensagem (aprox.)
const MAX_BOLHAS = 4;    // no máximo 4 mensagens seguidas
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function frases(paragrafo) {
  // separa por fim de frase mantendo a pontuação (não quebra "R$ 797,00" nem links)
  const partes = (paragrafo.match(/[^.!?…]+(?:[.!?…]+(?=\s|$)|$)/g) || [paragrafo]).map(s => s.trim()).filter(Boolean);
  // frase ainda longa demais: quebra em ";" e depois em ", " (sem cortar no meio de número)
  const out = [];
  for (const f of partes) {
    if (f.length <= MAX_BOLHA) { out.push(f); continue; }
    let atual = '';
    // não quebra em vírgula logo depois de palavra de ligação ("processo e, assim…")
    const pedacos = f.split(/(?<=;)\s+|(?<!\b(?:e|ou|mas|que|de|da|do|a|o|em|se|pois|porque),)(?<=[^\d],)\s+/i);
    for (const pedaco of pedacos) {
      if (!atual) { atual = pedaco; continue; }
      if ((atual + ' ' + pedaco).length <= MAX_BOLHA) atual += ' ' + pedaco;
      else {
        out.push(atual.endsWith(';') ? atual.slice(0, -1) + '.' : atual.replace(/,$/, ''));
        atual = atual.endsWith(';') ? pedaco.charAt(0).toUpperCase() + pedaco.slice(1) : pedaco;
      }
    }
    if (atual) out.push(atual);
  }
  return out;
}

function quebrar(texto) {
  const bolhas = [];
  for (const par of texto.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)) {
    if (par.length <= MAX_BOLHA) { bolhas.push(par); continue; }
    let atual = '';
    for (const f of frases(par)) {
      if (!atual) { atual = f; continue; }
      if ((atual + ' ' + f).length <= MAX_BOLHA) atual += ' ' + f;
      else { bolhas.push(atual); atual = f; }
    }
    if (atual) bolhas.push(atual);
  }
  // mais mensagens que o limite: junta as duas vizinhas que ficam mais curtas juntas
  while (bolhas.length > MAX_BOLHAS) {
    let melhor = 0;
    for (let i = 1; i < bolhas.length - 1; i++) if (bolhas[i].length + bolhas[i + 1].length < bolhas[melhor].length + bolhas[melhor + 1].length) melhor = i;
    bolhas.splice(melhor, 2, bolhas[melhor] + ' ' + bolhas[melhor + 1]);
  }
  return bolhas;
}

const out = [];
for (const item of $input.all()) {
  const { conversa_id } = item.json;
  const autor = item.json.autor || 'ia';
  const formato = item.json.formato === 'audio' ? 'audio' : 'texto';
  let texto = String(item.json.texto || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[ \t]*[—–][ \t]*/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim();
  if (!texto) continue;

  if (formato === 'audio') {
    const falado = texto.replace(/[*_~`]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    // "gravando áudio…" proporcional à fala (~15 caracteres por segundo), entre 3 e 12 s
    out.push({ json: { conversa_id, autor, formato, bloco: texto, falado, pausa_ms: rnd(1500, 3000),
      digitando_ms: Math.min(12000, Math.max(3000, Math.round(falado.length / 15 * 1000))) } });
    continue;
  }

  quebrar(texto).forEach((bloco, i) => {
    out.push({ json: {
      conversa_id, autor, formato, bloco, falado: null,
      // antes da 1ª mensagem: tempo de "ler" a mensagem do lead; entre mensagens: respiro curto
      pausa_ms: i === 0 ? rnd(1500, 3500) : rnd(600, 1500),
      // "digitando…": ~45 ms por caractere (digitação rápida no celular), entre 1,8 e 8 s, com variação
      digitando_ms: Math.min(8000, Math.max(1800, bloco.length * 45)) + rnd(0, 700),
    } });
  });
}
return out;
