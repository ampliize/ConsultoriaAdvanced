// Normaliza o webhook MESSAGES_UPSERT da Evolution API (ative "Webhook Base64" na instância)
const out = [];
for (const it of $input.all()) {
  const b = it.json.body ?? it.json;
  const ev = String(b.event || '').toLowerCase().replace('_', '.');
  if (ev && ev !== 'messages.upsert') continue;
  const d = Array.isArray(b.data) ? b.data[0] : (b.data || {});
  const k = d.key || {};
  const jids = [k.remoteJid, k.remoteJidAlt, k.senderPn].filter(Boolean);
  if (jids.some(j => j.endsWith('@g.us') || j.endsWith('@broadcast') || j.endsWith('@newsletter'))) continue;
  const jid = jids.find(j => j.endsWith('@s.whatsapp.net'));
  if (!jid || !k.id) continue;
  const m = d.message || {};
  let tipo = 'outro', texto = null, mime = null;
  if (m.conversation) { tipo = 'text'; texto = m.conversation; }
  else if (m.extendedTextMessage) { tipo = 'text'; texto = m.extendedTextMessage.text; }
  else if (m.imageMessage) { tipo = 'image'; texto = m.imageMessage.caption || null; mime = m.imageMessage.mimetype || 'image/jpeg'; }
  else if (m.audioMessage) { tipo = 'audio'; mime = 'audio/ogg'; }
  else if (m.videoMessage) { tipo = 'video'; texto = m.videoMessage.caption || null; }
  else if (m.documentMessage || m.documentWithCaptionMessage) {
    const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage || {};
    tipo = 'document'; texto = doc.fileName || doc.caption || null; mime = doc.mimetype || null;
  }
  else if (m.stickerMessage) { tipo = 'sticker'; }
  else if (m.locationMessage) { tipo = 'location'; }
  else if (m.contactMessage) { tipo = 'contact'; }
  else if (m.reactionMessage || m.protocolMessage || m.editedMessage || m.senderKeyDistributionMessage) { continue; }
  // anúncio click-to-WhatsApp (Meta Ads)
  const ctx = d.contextInfo || m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || {};
  const ad = ctx.externalAdReply;
  const anuncio = ad ? { titulo: ad.title || null, corpo: ad.body || null, url: ad.sourceUrl || null, source_id: ad.sourceId || null, tipo: ad.sourceType || null } : null;
  const base64 = (tipo === 'audio' || tipo === 'image') ? (m.base64 || d.base64 || null) : null;
  out.push({ json: {
    payload: { message_id: k.id, telefone: jid.split('@')[0], jid, from_me: k.fromMe === true, tipo, texto, media_url: null, push_name: d.pushName || null, anuncio },
    tipo,
    mime,
    base64
  } });
}
return out;
