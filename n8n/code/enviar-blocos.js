const out = [];
for (const item of $input.all()) {
  const { conversa_id } = item.json;
  const autor = item.json.autor || 'ia';
  const formato = item.json.formato === 'audio' ? 'audio' : 'texto';
  let texto = String(item.json.texto || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#+\s*/gm, '')
    .replace(/[ \t]*[—–][ \t]*/g, ', ')
    .trim();
  if (!texto) continue;
  if (formato === 'audio') {
    const falado = texto.replace(/[*_~`]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    out.push({ json: { conversa_id, autor, formato, bloco: texto, falado, delay_ms: Math.min(6000, Math.max(2000, falado.length * 40)) } });
    continue;
  }
  let partes = texto.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  if (partes.length > 3) partes = [partes[0], partes[1], partes.slice(2).join('\n\n')];
  for (const bloco of partes) {
    out.push({ json: { conversa_id, autor, formato, bloco, falado: null, delay_ms: Math.min(3500, Math.max(1200, bloco.length * 25)) + Math.floor(Math.random() * 400) } });
  }
}
return out;
