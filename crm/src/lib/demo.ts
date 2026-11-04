import type { Api, Snapshot, CrmUsuario } from './api';
import type { Conversa, Etapa, Lead, Mensagem, Reuniao, Evento, Alerta, ConfigRow } from './types';
import { FUNIL } from './types';

let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const uid = () => 'demo-' + Math.floor(rnd() * 1e12).toString(36) + Math.floor(rnd() * 1e6).toString(36);
const NOMES = ['Maria Souza', 'João Pedro Lima', 'Ana Clara Santos', 'Carlos Henrique', 'Fernanda Alves', 'Rafael Costa', 'Juliana Rocha', 'Marcos Vinícius', 'Patrícia Melo', 'Lucas Oliveira', 'Aline Ferreira', 'Bruno Carvalho', 'Camila Ribeiro', 'Diego Martins', 'Eduarda Gomes', 'Felipe Barros', 'Gabriela Nunes', 'Henrique Dias', 'Isabela Araújo', 'José Almeida', 'Karina Lopes', 'Leandro Pires', 'Mariana Teixeira', 'Natália Freitas', 'Otávio Moreira', 'Paula Cardoso', 'Renata Batista', 'Sérgio Monteiro', 'Tatiane Rezende', 'Vanessa Duarte'];
const MOTIVOS = ['sem_resposta', 'sem_resposta', 'sem_resposta', 'preco', 'sem_interesse', 'ja_resolveu'];
const DESQ = ['quer_dinheiro_imediato', 'exige_garantia', 'perdao_divida'];

const CONVERSA_EXEMPLO: [Mensagem['autor'], string, string?][] = [
  ['lead', 'Oi, vi o anúncio. Meu crédito foi negado no banco e não sei por quê'],
  ['ia', 'Oi! Aqui é da Advance Consultoria, tudo bem? Sinto muito pela negativa, isso é mais comum do que parece e tem caminho.\n\nVocê quer entender o motivo da negativa para conseguir crédito, ou já sabe que precisa limpar o nome?'],
  ['lead', 'Quero entender o motivo, preciso de um financiamento', 'audio'],
  ['ia', 'Entendi! Para eu te orientar melhor, qual é o seu nome completo?'],
  ['lead', 'Maria Souza Lima'],
  ['ia', 'Obrigado, Maria. Para fazer sua análise, preciso da sua autorização para consultar seu CPF e te enviar as informações do relatório. Posso seguir?'],
  ['lead', 'Pode sim'],
  ['ia', 'Perfeito! O Diagnóstico de Crédito faz um raio-X completo do seu CPF (apontamentos no Bacen, dívidas e score) e você ainda tem uma reunião com um gerente de crédito que mostra o caminho para aprovação.\n\nO investimento é de R$ 67,00 à vista, no PIX ou cartão. Posso te enviar o link?'],
  ['lead', 'Pode mandar'],
  ['ia', 'Aqui está o link de pagamento do Diagnóstico (R$ 67,00): https://pagamento.advance/diag'],
  ['lead', '[imagem] [comprovante_pagamento] PIX de R$ 67,00 hoje.', 'image'],
  ['ia', 'Recebido, Maria! O financeiro já vai confirmar. Agora me envie uma foto do seu RG ou CNH (frente e verso), por favor.'],
  ['humano', 'Oi Maria, aqui é a Claudianny da Advance. Já confirmei seu pagamento, obrigada!'],
];

function gerar(): Snapshot {
  seed = 42;
  const agora = Date.now();
  const leads: Lead[] = []; const conversas: Conversa[] = []; const reunioes: Reuniao[] = []; const eventos: Evento[] = [];
  const mensagens: Snapshot['mensagens'] = [];
  let evId = 1;
  for (let i = 0; i < 160; i++) {
    const criado = agora - Math.floor(Math.pow(rnd(), 1.4) * 30 * 86400000);
    const servico = rnd() < 0.68 ? 'diagnostico' : 'limpa_nome';
    // até onde o lead foi no funil
    const r = rnd();
    let alvo = r < 0.05 ? 0 : r < 0.32 ? 1 : r < 0.52 ? 2 : r < 0.68 ? 3 : r < 0.76 ? 4 : r < 0.9 ? 5 : 6;
    if (servico === 'limpa_nome' && alvo === 5) alvo = 6;
    const perdeu = alvo >= 1 && alvo <= 3 && rnd() < 0.5;
    const desq = !perdeu && alvo === 1 && rnd() < 0.25;
    const nome = pick(NOMES);
    const id = uid();
    const t: Partial<Record<Etapa, string>> = {};
    let cursor = criado;
    for (let k = 0; k <= alvo; k++) {
      const e = FUNIL[k]; cursor += k === 0 ? 0 : Math.floor(rnd() * 6 * 3600000) + 60000; t[e] = new Date(Math.min(cursor, agora - 60000)).toISOString();
      eventos.push({ id: evId++, lead_id: id, etapa_de: k ? FUNIL[k - 1] : null, etapa_para: e, motivo: null, por: 'sistema', criado_em: t[e]! });
    }
    let etapa: Etapa = FUNIL[alvo];
    let motivo: string | null = null;
    if (perdeu || desq) {
      etapa = perdeu ? 'perdido' : 'desqualificado'; motivo = perdeu ? pick(MOTIVOS) : pick(DESQ);
      const em = new Date(Math.min(cursor + 3600000 * 30, agora - 60000)).toISOString();
      eventos.push({ id: evId++, lead_id: id, etapa_de: FUNIL[alvo], etapa_para: etapa, motivo, por: 'ia', criado_em: em }); t[etapa] = em;
    }
    const pago = alvo >= 4;
    const valor = servico === 'diagnostico' ? 67 : rnd() < 0.6 ? 797 : 1100;
    const tel = '55799' + String(81000000 + Math.floor(rnd() * 9999999)).padStart(8, '0');
    const respMs = Math.floor(rnd() * 25000) + 3000;
    leads.push({
      id, telefone: tel, nome: alvo >= 2 ? nome : null, nome_whatsapp: nome.split(' ')[0], cpf_cnpj: alvo >= 2 ? '***' : null, email: null,
      servico: alvo >= 1 ? servico as any : 'indefinido', objetivo: servico === 'diagnostico' ? 'entender_negativa' : 'limpar_nome',
      urgencia: alvo >= 2 ? pick(['alta', 'alta', 'media', 'baixa']) as any : null, etapa, motivo_perda: motivo,
      origem: rnd() < 0.7 ? 'meta_ads' : 'google_ads', anuncio: { titulo: servico === 'diagnostico' ? 'Crédito negado? Descubra o motivo' : 'Limpe seu nome em 30 dias' },
      consentimento_lgpd_em: alvo >= 2 ? t.qualificado! : null, forma_pagamento: pago ? (valor === 1100 ? 'tap' : 'avista') : null,
      valor_previsto: alvo >= 3 ? valor : null, valor_venda: pago ? valor : null,
      pagamento_status: pago ? 'confirmado' : alvo >= 3 ? 'link_enviado' : 'nenhum', documento_recebido: alvo >= 5, contrato_assinado: alvo >= 6 && servico === 'limpa_nome',
      resumo: servico === 'diagnostico' ? 'Crédito negado, quer entender o motivo e conseguir financiamento.' : 'Negativado no Serasa, precisa limpar o nome com urgência.',
      observacoes: null, primeira_msg_em: new Date(criado).toISOString(), primeira_resposta_em: new Date(criado + respMs).toISOString(),
      ultima_msg_lead_em: new Date(cursor).toISOString(), qualificado_em: t.qualificado || null, proposta_em: t.proposta || null, pago_em: t.pago || null,
      agendado_em: t.agendado || null, concluido_em: t.concluido || null, perdido_em: t.perdido || t.desqualificado || null,
      criado_em: new Date(criado).toISOString(), atualizado_em: new Date(cursor).toISOString(),
    });
    const cid = uid();
    const recente = agora - cursor < 86400000;
    const humano = recente && rnd() < 0.18;
    const aguardando = !humano && recente && rnd() < 0.08;
    const humanoEm = humano ? new Date(agora - Math.floor(rnd() * 14 * 60000)).toISOString() : null;
    conversas.push({
      id: cid, lead_id: id, telefone: tel, modo: humano || aguardando ? 'humano' : 'ia', humano_ultima_atividade_em: humanoEm,
      assumida_manual: false, assumida_por: null, aguardando_humano: aguardando, motivo_handoff: aguardando ? 'pedido_lead' : null,
      ultima_msg_em: new Date(cursor).toISOString(), nao_lidas: humano || aguardando ? 1 : 0, followup_etapa: 0, criado_em: new Date(criado).toISOString(),
      ia_ativa: !humano && !aguardando, ia_retorna_em: humanoEm ? new Date(new Date(humanoEm).getTime() + 15 * 60000).toISOString() : null,
      nome: alvo >= 2 ? nome : null, nome_whatsapp: nome.split(' ')[0], etapa, servico, urgencia: null, origem: 'meta_ads', pagamento_status: pago ? 'confirmado' : 'nenhum',
      ultima_msg_texto: CONVERSA_EXEMPLO[Math.min(CONVERSA_EXEMPLO.length - 1, alvo * 2 + 1)][1].split('\n')[0], ultima_msg_autor: humano ? 'humano' : 'ia',
    });
    const nMsg = 2 + alvo * 3 + Math.floor(rnd() * 4);
    for (let m = 0; m < nMsg; m++) {
      const autor = m % 2 === 0 ? 'lead' : (humano && m === nMsg - 1 ? 'humano' : 'ia');
      mensagens.push({ autor, conversa_id: cid, direcao: autor === 'lead' ? 'in' : 'out', criado_em: new Date(criado + m * 90000).toISOString() });
    }
    if (alvo >= 5 && servico === 'diagnostico') {
      const ini = alvo === 6 ? agora - Math.floor(rnd() * 20) * 86400000 : agora + Math.floor(rnd() * 6 * 86400000) + 3600000;
      const d = new Date(ini); d.setUTCMinutes(rnd() < 0.5 ? 0 : 30, 0, 0); d.setUTCHours(12 + Math.floor(rnd() * 8));
      reunioes.push({ id: uid(), lead_id: id, inicio: d.toISOString(), fim: new Date(d.getTime() + 1800000).toISOString(), status: alvo === 6 ? 'realizada' : 'agendada', meet_link: 'https://meet.google.com/adv-' + Math.floor(rnd() * 9999), closer: 'Matheus', observacao: null });
    }
  }
  const alertas: Alerta[] = conversas.filter(c => c.aguardando_humano).map((c, i) => ({ id: i + 1, tipo: 'handoff', lead_id: c.lead_id, conversa_id: c.id, mensagem: 'Transferência (pedido_lead): lead pediu para falar com um especialista.', lido: false, criado_em: c.ultima_msg_em! }));
  alertas.push({ id: 99, tipo: 'pagamento_informado', lead_id: leads[0].id, conversa_id: conversas[0].id, mensagem: 'Lead informou pagamento: comprovante PIX de R$ 67. Confirme no meio de pagamento.', lido: false, criado_em: new Date(agora - 600000).toISOString() });
  const cfg = (chave: string, valor: any, descricao: string): ConfigRow => ({ chave, valor, descricao, atualizado_em: new Date().toISOString(), atualizado_por: null });
  const config = Object.fromEntries([
    cfg('sdr_pausado_global', { pausado: false }, 'Pausa geral de emergência do SDR IA'),
    cfg('minutos_retorno_humano', 15, 'Minutos sem mensagem do humano para a IA voltar'),
    cfg('audio_modo', 'espelhar', 'espelhar · sempre · nunca'),
    cfg('elevenlabs_voice_id', 'voz-claudianny', 'ID da voz clonada'),
    cfg('link_pagamento_diagnostico', 'https://pagamento.advance/diag', 'Link Diagnóstico (R$ 67)'),
    cfg('link_pagamento_limpa_nome_avista', 'https://pagamento.advance/limpa', 'Link Limpa Nome à vista (R$ 797)'),
    cfg('link_pagamento_limpa_nome_tap', 'https://pagamento.advance/tap', 'Link entrada TAP'),
    cfg('agenda_closer', { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00', almoco: ['12:00', '13:30'], duracao_min: 30, antecedencia_horas: 2, dias_a_frente: 7, bloqueios: [] }, 'Disponibilidade do especialista'),
    cfg('followup_horas', [2, 24, 48], 'Régua de follow-up'),
    cfg('followup_mensagens', ['Oi, {nome}! Conseguiu ver minha última mensagem?', '{nome}, ainda posso te ajudar?', '{nome}, vou deixar seu atendimento em pausa.'], 'Textos dos lembretes'),
    cfg('whatsapp_equipe', ['5579981045273'], 'Números que recebem alertas'),
    cfg('evolution_base_url', 'https://evolution.exemplo.com', 'URL da Evolution API'),
    cfg('evolution_instancia', 'advance', 'Instância do WhatsApp'),
    cfg('exigir_pagamento_para_agendar', true, 'Diagnóstico: só agenda após pagamento'),
  ].map(r => [r.chave, r]));
  return { leads, conversas, reunioes, eventos, alertas, config, mensagens };
}

export function apiDemo(): Api {
  const db = gerar();
  const ouvintes = new Set<(t: string) => void>();
  const avisar = (t: string) => ouvintes.forEach(f => f(t));
  const conv = (id: string) => db.conversas.find(c => c.id === id)!;
  const usuarios: CrmUsuario[] = [{ email: 'ampliize@gmail.com', nome: 'Ampliize', papel: 'ampliize', ativo: true }, { email: 'claudianny@advance.com', nome: 'Claudianny Rodrigues', papel: 'advance', ativo: true }];
  return {
    demo: true,
    email: () => 'demo@advance',
    async carregar() { return structuredClone(db); },
    async mensagens(id) {
      const c = conv(id); const base = new Date(c.criado_em).getTime();
      const lim = Math.min(CONVERSA_EXEMPLO.length, 2 + ['novo', 'em_atendimento', 'qualificado', 'proposta', 'pago', 'agendado', 'concluido'].indexOf(c.etapa) * 2 + 2);
      return CONVERSA_EXEMPLO.slice(0, Math.max(2, lim)).filter(m => m[0] !== 'humano' || c.modo === 'humano').map((m, i) => ({
        id: i, conversa_id: id, lead_id: c.lead_id, direcao: m[0] === 'lead' ? 'in' : 'out', autor: m[0], tipo: m[2] || 'text',
        texto: m[2] === 'audio' || m[2] === 'image' ? null : m[1].replace('Maria', (c.nome || c.nome_whatsapp || 'Maria').split(' ')[0]),
        midia_descricao: m[2] ? m[1] : null, status_envio: 'enviado', criado_em: new Date(base + i * 70000).toISOString(),
      }));
    },
    async pausaGeral(p) { db.config.sdr_pausado_global.valor = { pausado: p, por: 'demo@advance', em: new Date().toISOString() }; db.conversas.forEach(c => c.ia_ativa = !p && c.modo === 'ia'); avisar('config'); },
    async assumir(id) { Object.assign(conv(id), { assumida_manual: true, assumida_por: 'demo@advance', modo: 'humano', ia_ativa: false, aguardando_humano: false, ia_retorna_em: null }); avisar('conversas'); },
    async devolver(id) { Object.assign(conv(id), { assumida_manual: false, assumida_por: null, modo: 'ia', ia_ativa: !db.config.sdr_pausado_global.valor.pausado, aguardando_humano: false, humano_ultima_atividade_em: null, ia_retorna_em: null }); avisar('conversas'); },
    async moverEtapa(lead, etapa, motivo) { const l = db.leads.find(x => x.id === lead)!; db.eventos.push({ id: Date.now(), lead_id: lead, etapa_de: l.etapa, etapa_para: etapa, motivo: motivo || null, por: 'demo@advance', criado_em: new Date().toISOString() }); l.etapa = etapa; l.motivo_perda = motivo || null; const c = db.conversas.find(x => x.lead_id === lead); if (c) c.etapa = etapa; avisar('leads'); },
    async confirmarPagamento(lead, valor, forma) { const l = db.leads.find(x => x.id === lead)!; Object.assign(l, { pagamento_status: 'confirmado', valor_venda: valor, forma_pagamento: forma, pago_em: new Date().toISOString() }); if (['novo', 'em_atendimento', 'qualificado', 'proposta'].includes(l.etapa)) l.etapa = 'pago'; avisar('leads'); },
    async atualizarLead(id, patch) { Object.assign(db.leads.find(x => x.id === id)!, patch); avisar('leads'); },
    async atualizarReuniao(id, patch) { Object.assign(db.reunioes.find(x => x.id === id)!, patch); avisar('reunioes'); },
    async salvarConfig(chave, valor) { db.config[chave] = { ...(db.config[chave] || { chave, descricao: null }), valor, atualizado_em: new Date().toISOString(), atualizado_por: 'demo@advance' } as ConfigRow; avisar('config'); },
    async marcarAlertasLidos() { db.alertas.forEach(a => a.lido = true); avisar('alertas'); },
    async usuarios() { return usuarios; },
    async salvarUsuario(u) { const i = usuarios.findIndex(x => x.email === u.email); if (i >= 0) usuarios[i] = u; else usuarios.push(u); },
    assinar(f) { ouvintes.add(f); return () => ouvintes.delete(f); },
    async sair() { /* demo */ },
  };
}
