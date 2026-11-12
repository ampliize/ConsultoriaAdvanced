import type { Api, Snapshot, CrmUsuario } from './api';
import type { Conversa, Etapa, Lead, Mensagem, Reuniao, Evento, Alerta, ConfigRow, Contrato, Cobranca, Comissao, Notificacao } from './types';
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
  ['ia', 'Perfeito! O Diagnóstico de Crédito faz um raio-X completo do seu CPF (apontamentos no Bacen, dívidas e score) e você ainda tem uma reunião com um gerente de crédito que mostra o caminho para aprovação.\n\nO investimento é de R$ 67,00 à vista, no PIX ou boleto. Posso te enviar o link?'],
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
    const valor = servico === 'diagnostico' ? 67 : pick([597, 597, 800, 1047, 1047, 1047]);
    const tel = '55799' + String(81000000 + Math.floor(rnd() * 9999999)).padStart(8, '0');
    const respMs = Math.floor(rnd() * 25000) + 3000;
    leads.push({
      id, telefone: tel, nome: alvo >= 2 ? nome : null, nome_whatsapp: nome.split(' ')[0], cpf_cnpj: alvo >= 2 ? '***' : null, email: null,
      servico: alvo >= 1 ? servico as any : 'indefinido', objetivo: servico === 'diagnostico' ? 'entender_negativa' : 'limpar_nome',
      urgencia: alvo >= 2 ? pick(['alta', 'alta', 'media', 'baixa']) as any : null, etapa, motivo_perda: motivo,
      origem: rnd() < 0.7 ? 'meta_ads' : 'google_ads', anuncio: { titulo: servico === 'diagnostico' ? 'Crédito negado? Descubra o motivo' : 'Limpe seu nome em 30 dias' },
      consentimento_lgpd_em: alvo >= 2 ? t.qualificado! : null, forma_pagamento: pago ? (valor === 1047 ? 'tap' : valor === 800 ? '2x' : 'avista') : null,
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
    cfg('link_pagamento_limpa_nome_avista', 'https://pagamento.advance/limpa', 'Link Limpa Nome à vista (R$ 597)'),
    cfg('link_pagamento_limpa_nome_2x', '', 'Link Limpa Nome 2x'),
    cfg('link_pagamento_limpa_nome_tap', 'https://pagamento.advance/tap', 'Link entrada TAP'),
    cfg('agenda_closer', { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00', almoco: ['12:00', '13:30'], duracao_min: 30, antecedencia_horas: 2, dias_a_frente: 7, bloqueios: [] }, 'Disponibilidade do especialista'),
    cfg('followup_horas', [2, 24, 48], 'Régua de follow-up'),
    cfg('followup_mensagens', ['Oi, {nome}! Conseguiu ver minha última mensagem?', '{nome}, ainda posso te ajudar?', '{nome}, vou deixar seu atendimento em pausa.'], 'Textos dos lembretes'),
    cfg('whatsapp_equipe', ['5579981045273'], 'Números que recebem alertas'),
    cfg('evolution_base_url', 'https://evolution.exemplo.com', 'URL da Evolution API'),
    cfg('evolution_instancia', 'advance', 'Instância do WhatsApp'),
    cfg('exigir_pagamento_para_agendar', true, 'Diagnóstico: só agenda após pagamento'),
    cfg('asaas_ativo', true, 'Gera as cobranças pelo Asaas'),
    cfg('asaas_base_url', 'https://api-sandbox.asaas.com/v3', 'API do Asaas'),
    cfg('asaas_forma_cobranca', 'BOLETO', 'Tipo da cobrança'),
    cfg('split_beneficiarios', [{ nome: 'Davy', walletId: 'demo-wallet-davy', percentual: 12.5 }, { nome: 'Caio', walletId: 'demo-wallet-caio', percentual: 12.5 }], 'Beneficiários do split'),
    cfg('planos_limpa_nome', PLANOS, 'Modalidades do Limpa Nome'),
    cfg('notif_janela', { inicio: '08:00', fim: '20:00' }, 'Horário das notificações'),
    cfg('notif_lembrete_dias', [3, 0], 'Lembrete antes do vencimento'),
    cfg('notif_vencida_dias', [1, 5], 'Aviso depois do vencimento'),
    cfg('notif_textos', NOTIF_TEXTOS, 'Textos das notificações'),
    cfg('processo_etapas', PROCESSO_ETAPAS, 'Etapas do processo'),
    cfg('custo_produto', { valor: 197, walletId: '', servicos: ['limpa_nome', 'combo', 'rating'], por_servico: { limpa_nome: 197, combo: 197, rating: 150 } }, 'Custo fixo por contrato'),
    cfg('split_servicos', ['limpa_nome', 'combo', 'rating'], 'Produtos com comissão'),
    cfg('planos_combo', { avista: { nome: 'À vista', parcelas: [1500] }, '2x': { nome: '2x de R$ 900', parcelas: [900, 900] }, tap: { nome: 'TAP', parcelas: [597, 297, 297, 297, 297, 297] } }, 'Combo'),
    cfg('planos_rating', { avista: { nome: 'À vista', parcelas: [997] }, '2x': { nome: '2x de R$ 600', parcelas: [600, 600] } }, 'Rating'),
  ].map(r => [r.chave, r]));
  const fin = financeiro(leads, agora);
  return { leads, conversas, reunioes, eventos, alertas, config, mensagens, ...fin };
}

export const PLANOS = { avista: { nome: 'À vista', parcelas: [597] }, '2x': { nome: '2x de R$ 400', parcelas: [400, 400] }, tap: { nome: 'TAP: entrada + 5x', parcelas: [297, 150, 150, 150, 150, 150] } };
export const NOTIF_TEXTOS = {
  lembrete: 'Oi, {nome}! Passando pra lembrar que a {parcela} do seu Limpa Nome, de {valor}, vence em {vencimento}. Dá pra pagar por PIX ou boleto neste link: {link}',
  lembrete_hoje: 'Oi, {nome}! A {parcela} do seu Limpa Nome, de {valor}, vence hoje. Segue o link pra pagar por PIX ou boleto: {link}',
  vencida: '{nome}, ainda não identificamos o pagamento da {parcela} do seu Limpa Nome, de {valor}, que venceu em {vencimento}. Se já pagou, pode desconsiderar. Pra regularizar: {link}',
  link: '{nome}, aqui está o seu link de pagamento ({parcela}, {valor}) por PIX ou boleto: {link}',
  quitacao: '{nome}, conforme combinado, segue o link para quitar o saldo do seu Limpa Nome, de {valor}, por PIX ou boleto: {link}',
};
export const PROCESSO_ETAPAS = [
  { id: 'contrato_assinado', nome: 'Contrato assinado', texto: '{nome}, recebemos seu contrato assinado. Agora nossa equipe vai preparar a sua ação. Qualquer novidade a gente te avisa por aqui.' },
  { id: 'protocolado', nome: 'Ação protocolada', texto: '{nome}, sua ação foi protocolada na justiça. {detalhe} A gente acompanha e te avisa a cada novidade.' },
  { id: 'em_andamento', nome: 'Em andamento', texto: '{nome}, seu processo segue em andamento. {detalhe} Assim que tiver novidade, te aviso por aqui.' },
  { id: 'baixa', nome: 'Restrições baixadas', texto: '{nome}, boa notícia! As restrições apontadas na ação foram baixadas. {detalhe}' },
  { id: 'concluido', nome: 'Processo concluído', texto: '{nome}, seu processo do Limpa Nome foi concluído. {detalhe} Obrigado pela confiança na Advance!' },
];
const DIA = 86400000;
const addMes = (t: number, m: number) => { const d = new Date(t); d.setMonth(d.getMonth() + m); return d.getTime(); };
const isoDia = (t: number) => new Date(t).toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

// contratos do Limpa Nome dos leads pagos, com parcelas, comissões e avisos
function financeiro(leads: Lead[], agora: number) {
  const contratos: Contrato[] = []; const cobrancas: Cobranca[] = []; const comissoes: Comissao[] = []; const notificacoes: Notificacao[] = [];
  let comId = 1, notId = 1;
  for (const l of leads.filter(x => x.servico === 'limpa_nome' && x.pagamento_status === 'confirmado')) {
    const mod = (l.forma_pagamento || 'avista') as 'avista' | '2x' | 'tap';
    const parcelas = (PLANOS as any)[mod].parcelas as number[];
    const ini = addMes(new Date(l.pago_em || l.criado_em).getTime(), -pick([0, 0, 1, 2, 3, 4]));
    const ctId = uid();
    const atrasado = rnd() < 0.3;
    const quitou = mod === 'tap' && !atrasado && rnd() < 0.15;
    const cobs: Cobranca[] = parcelas.map((v, i) => {
      const venc = addMes(ini, i);
      const passou = venc < agora - DIA;
      let status: Cobranca['status'] = i === 0 ? 'recebida' : passou ? (atrasado && i === parcelas.length - 1 ? 'vencida' : 'recebida') : venc - agora < 10 * DIA ? 'pendente' : 'planejada';
      if (atrasado && passou && i > 0 && cobrancas.length % 3 === 0) status = 'vencida';
      return {
        id: uid(), contrato_id: ctId, lead_id: l.id, numero: i + 1, tipo: mod === 'avista' ? 'avista' : mod === 'tap' && i === 0 ? 'adesao' : 'parcela',
        valor: v, vencimento: isoDia(venc), status, motivo_cancelamento: null, asaas_payment_id: status === 'planejada' ? null : 'pay_demo' + Math.floor(rnd() * 1e9),
        invoice_url: status === 'planejada' ? null : 'https://sandbox.asaas.com/i/demo' + Math.floor(rnd() * 1e6), forma_paga: status === 'recebida' ? pick(['PIX', 'PIX', 'BOLETO']) : null,
        valor_pago: status === 'recebida' ? v : null, valor_liquido: status === 'recebida' ? r2(v - 1.99) : null, valor_estornado: null,
        pago_em: status === 'recebida' ? new Date(Math.min(venc, agora - 3600000)).toISOString() : null, erro: null, criado_em: new Date(venc - 10 * DIA).toISOString(),
      };
    });
    if (quitou) {
      const abertas = cobs.filter(c => ['pendente', 'planejada'].includes(c.status));
      const saldo = abertas.reduce((a, c) => a + c.valor, 0);
      if (saldo > 0) {
        abertas.forEach(c => { c.status = 'cancelada'; c.motivo_cancelamento = 'quitacao'; });
        cobs.push({ id: uid(), contrato_id: ctId, lead_id: l.id, numero: cobs.length + 1, tipo: 'quitacao', valor: saldo, vencimento: isoDia(agora - 2 * DIA), status: 'recebida', motivo_cancelamento: null, asaas_payment_id: 'pay_demo_q', invoice_url: 'https://sandbox.asaas.com/i/demoq', forma_paga: 'PIX', valor_pago: saldo, valor_liquido: r2(saldo - 1.99), valor_estornado: null, pago_em: new Date(agora - 2 * DIA).toISOString(), erro: null, criado_em: new Date(agora - 3 * DIA).toISOString() });
      }
    }
    let custoPend = 197;
    for (const c of cobs) {
      if (c.status === 'planejada' || c.status === 'cancelada') continue;
      const custoC = Math.min(custoPend, c.valor); custoPend -= custoC; c.custo_alocado = custoC;
      const base = c.valor - custoC;
      for (const nome of ['Davy', 'Caio']) {
        const v = nome === 'Davy' ? Math.round(base * 12.5) / 100 : r2(Math.round(base * 25) / 100 - Math.round(base * 12.5) / 100);
        comissoes.push({ id: comId++, cobranca_id: c.id, contrato_id: ctId, lead_id: l.id, beneficiario: nome, wallet_id: 'demo-wallet-' + nome.toLowerCase(), base, percentual: 12.5, valor: v,
          status: c.status === 'recebida' ? (c.pago_em && agora - new Date(c.pago_em).getTime() > DIA ? 'liquidada' : 'a_liquidar') : 'prevista', liquidada_em: null, criado_em: c.criado_em });
      }
      if (c.status === 'pendente' || c.status === 'vencida') {
        notificacoes.push({ id: notId++, lead_id: l.id, contrato_id: ctId, cobranca_id: c.id, tipo: c.status === 'vencida' ? 'vencida' : 'lembrete', status: 'enviada', criado_por: 'sistema',
          texto: c.status === 'vencida' ? `${(l.nome || '').split(' ')[0]}, ainda não identificamos o pagamento da parcela do seu Limpa Nome, de R$ ${c.valor},00. Pra regularizar: ${c.invoice_url}` : `Oi, ${(l.nome || '').split(' ')[0]}! Passando pra lembrar que a parcela do seu Limpa Nome vence em breve: ${c.invoice_url}`,
          agendada_para: new Date(agora - DIA).toISOString(), enviada_em: new Date(agora - DIA).toISOString(), criado_em: new Date(agora - DIA).toISOString() });
      }
    }
    const pagas = cobs.filter(c => c.status === 'recebida');
    const abertas = cobs.filter(c => ['planejada', 'pendente', 'vencida'].includes(c.status));
    const etapaProc = pick([null, 'contrato_assinado', 'protocolado', 'protocolado', 'em_andamento', 'baixa']);
    contratos.push({
      id: ctId, lead_id: l.id, servico: 'limpa_nome', modalidade: mod, valor_total: parcelas.reduce((a, b) => a + b, 0),
      status: abertas.length === 0 ? 'quitado' : abertas.some(c => c.status === 'vencida') ? 'inadimplente' : 'ativo',
      processo_etapa: etapaProc, processo_detalhe: etapaProc === 'protocolado' ? 'Número do processo: 0001234-56.2026.8.25.0001.' : null,
      processo_atualizado_em: etapaProc ? new Date(agora - Math.floor(rnd() * 10) * DIA).toISOString() : null,
      aderido_em: new Date(ini).toISOString(), quitado_em: abertas.length === 0 ? new Date(agora - DIA).toISOString() : null,
      desconto_quitacao: null, criado_por: 'ia', criado_em: new Date(ini - DIA).toISOString(),
      nome: l.nome, nome_whatsapp: l.nome_whatsapp, telefone: l.telefone, cpf_cnpj: l.cpf_cnpj, email: l.email,
      pago: pagas.reduce((a, c) => a + (c.valor_pago || 0), 0), saldo_devedor: abertas.reduce((a, c) => a + c.valor, 0),
      vencido: abertas.filter(c => c.status === 'vencida').reduce((a, c) => a + c.valor, 0),
      pagamentos_feitos: pagas.length, pagamentos_total: cobs.filter(c => c.status !== 'cancelada' && c.tipo !== 'quitacao').length,
      custo_produto: 197, custo_recuperado: pagas.reduce((a, c) => a + (c.custo_alocado || 0), 0),
    });
    cobrancas.push(...cobs);
  }
  return { contratos, cobrancas, comissoes, notificacoes };
}

export function apiDemo(): Api {
  const db = gerar();
  const ouvintes = new Set<(t: string) => void>();
  const avisar = (t: string) => ouvintes.forEach(f => f(t));
  const conv = (id: string) => db.conversas.find(c => c.id === id)!;
  const enviadas: Record<string, Mensagem[]> = {};
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
      } as Mensagem)).concat(enviadas[id] || []);
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
    async whatsapp(acao) {
      const qr = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"/>' + Array.from({ length: 300 }, (_, i) => { const x = (i * 7919) % 25 + 2, y = (i * 104729) % 25 + 2; return `<rect x="${x}" y="${y}" width="1" height="1"/>`; }).join('') + '<path d="M2 2h7v7H2zM20 2h7v7h-7zM2 20h7v7H2z" fill="none" stroke="#000"/></svg>');
      if (acao === 'conectar') { (this as any)._n = ((this as any)._n || 0) + 1; return { ok: true, estado: 'connecting', qr }; }
      if (acao === 'desconectar') { (this as any)._n = 0; return { ok: true, estado: 'close' }; }
      return { ok: true, estado: ((this as any)._n || 0) >= 1 ? 'open' : 'close', instancia: 'advance' };
    },
    async enviarMensagem(id, texto) {
      const c = conv(id);
      (enviadas[id] ||= []).push({ id: 1000 + (enviadas[id].length), conversa_id: id, lead_id: c.lead_id, direcao: 'out', autor: 'humano', tipo: 'text', texto, midia_descricao: null, status_envio: 'enviado', criado_em: new Date().toISOString() });
      const ret = new Date(Date.now() + 15 * 60000).toISOString();
      Object.assign(c, { modo: 'humano', ia_ativa: false, aguardando_humano: false, humano_ultima_atividade_em: new Date().toISOString(), ia_retorna_em: c.assumida_manual ? null : ret, ultima_msg_texto: texto, ultima_msg_autor: 'humano', ultima_msg_em: new Date().toISOString(), nao_lidas: 0 });
      avisar('mensagens');
      return { ok: true };
    },
    async criarContrato(leadId, servico, modalidade) {
      const l = db.leads.find(x => x.id === leadId);
      if (!l?.nome || !l.cpf_cnpj) return { ok: false, erro: 'Preencha o nome completo e o CPF/CNPJ do lead antes de criar o contrato.' };
      if (db.contratos.some(c => c.lead_id === leadId && c.servico === servico && ['aguardando_pagamento', 'ativo', 'inadimplente'].includes(c.status))) return { ok: false, erro: 'Este cliente já tem um contrato ativo deste serviço.' };
      const parcelas = servico === 'diagnostico' ? [67] : (PLANOS as any)[modalidade].parcelas as number[];
      const id = uid();
      db.contratos.unshift({ id, lead_id: leadId, servico: servico as any, modalidade: modalidade as any, valor_total: parcelas.reduce((a, b) => a + b, 0), status: 'aguardando_pagamento', processo_etapa: null, processo_detalhe: null, processo_atualizado_em: null, aderido_em: null, quitado_em: null, desconto_quitacao: null, criado_por: 'demo@advance', criado_em: new Date().toISOString(), nome: l.nome, nome_whatsapp: l.nome_whatsapp, telefone: l.telefone, cpf_cnpj: l.cpf_cnpj, email: l.email, pago: 0, saldo_devedor: parcelas.reduce((a, b) => a + b, 0), vencido: 0, pagamentos_feitos: 0, pagamentos_total: parcelas.length, custo_produto: servico === 'limpa_nome' ? 197 : 0, custo_recuperado: 0 });
      parcelas.forEach((v, i) => db.cobrancas.push({ id: uid(), contrato_id: id, lead_id: leadId, numero: i + 1, tipo: servico === 'diagnostico' ? 'unica' : modalidade === 'avista' ? 'avista' : modalidade === 'tap' && i === 0 ? 'adesao' : 'parcela', valor: v, vencimento: i === 0 ? isoDia(Date.now() + 2 * DIA) : null, status: i === 0 ? 'a_gerar' : 'planejada', motivo_cancelamento: null, asaas_payment_id: null, invoice_url: null, forma_paga: null, valor_pago: null, valor_liquido: null, valor_estornado: null, pago_em: null, erro: null, criado_em: new Date().toISOString() }));
      avisar('contratos'); return { ok: true };
    },
    async quitar(id, desconto, motivo) {
      const ct = db.contratos.find(c => c.id === id)!;
      if (desconto > 0 && !motivo.trim()) return { ok: false, erro: 'Informe o motivo/autorização do desconto.' };
      const abertas = db.cobrancas.filter(c => c.contrato_id === id && ['planejada', 'a_gerar', 'pendente', 'vencida'].includes(c.status));
      const saldo = abertas.reduce((a, c) => a + c.valor, 0); const final = r2(saldo - desconto);
      if (final < 5) return { ok: false, erro: 'O valor final da quitação precisa ser de pelo menos R$ 5,00.' };
      abertas.forEach(c => { c.status = c.asaas_payment_id ? 'a_cancelar' : 'cancelada'; c.motivo_cancelamento = 'quitacao'; });
      db.cobrancas.push({ id: uid(), contrato_id: id, lead_id: ct.lead_id, numero: Math.max(...db.cobrancas.filter(c => c.contrato_id === id).map(c => c.numero)) + 1, tipo: 'quitacao', valor: final, vencimento: isoDia(Date.now() + 2 * DIA), status: 'a_gerar', motivo_cancelamento: null, asaas_payment_id: null, invoice_url: null, forma_paga: null, valor_pago: null, valor_liquido: null, valor_estornado: null, pago_em: null, erro: null, criado_em: new Date().toISOString() });
      ct.saldo_devedor = final; ct.vencido = 0; ct.desconto_quitacao = desconto || null;
      avisar('cobrancas'); return { ok: true, valor_final: final, saldo, desconto };
    },
    async andamento(id, etapa, detalhe, enviar) {
      const ct = db.contratos.find(c => c.id === id)!; const e = PROCESSO_ETAPAS.find(x => x.id === etapa)!;
      Object.assign(ct, { processo_etapa: etapa, processo_detalhe: detalhe || null, processo_atualizado_em: new Date().toISOString() });
      const texto = e.texto.replace('{nome}', (ct.nome || '').split(' ')[0]).replace('{detalhe}', detalhe || '').replace(/\s{2,}/g, ' ').trim();
      if (enviar) db.notificacoes.unshift({ id: Date.now(), lead_id: ct.lead_id, contrato_id: id, cobranca_id: null, tipo: 'andamento', texto, status: 'pendente', agendada_para: new Date().toISOString(), enviada_em: null, criado_por: 'demo@advance', criado_em: new Date().toISOString() });
      avisar('contratos'); return { ok: true, texto };
    },
    async reenviarLink(id) {
      const c = db.cobrancas.find(x => x.id === id)!;
      db.notificacoes.unshift({ id: Date.now(), lead_id: c.lead_id, contrato_id: c.contrato_id, cobranca_id: id, tipo: 'manual', texto: 'Link de pagamento: ' + c.invoice_url, status: 'pendente', agendada_para: new Date().toISOString(), enviada_em: null, criado_por: 'demo@advance', criado_em: new Date().toISOString() });
      avisar('notificacoes'); return { ok: true };
    },
    async gerarCobranca(leadId, d) {
      const l = db.leads.find(x => x.id === leadId)!;
      if (d.nome) l.nome = d.nome; if (d.cpf_cnpj) l.cpf_cnpj = String(d.cpf_cnpj).replace(/\D/g, ''); if (d.email) l.email = d.email;
      if (!l.nome || !l.cpf_cnpj) return { ok: false, erro: 'Preencha o nome completo e o CPF ou CNPJ do cliente.' };
      if (d.tipo === 'produto') return this.criarContrato(leadId, d.servico, d.modalidade);
      const v = Number(d.valor) || 0; if (v < 5) return { ok: false, erro: 'O valor mínimo é R$ 5,00.' };
      const n = Number(d.parcelas) || 0, vp = Number(d.valor_parcela) || 0; const id = uid(); const total = v + n * vp;
      db.contratos.unshift({ id, lead_id: leadId, servico: 'personalizada' as any, modalidade: 'personalizada' as any, descricao: d.descricao, valor_total: total, status: 'aguardando_pagamento', processo_etapa: null, processo_detalhe: null, processo_atualizado_em: null, aderido_em: null, quitado_em: null, desconto_quitacao: null, criado_por: 'demo@advance', criado_em: new Date().toISOString(), nome: l.nome, nome_whatsapp: l.nome_whatsapp, telefone: l.telefone, cpf_cnpj: l.cpf_cnpj, email: l.email, pago: 0, saldo_devedor: total, vencido: 0, pagamentos_feitos: 0, pagamentos_total: n + 1, custo_produto: Number(d.custo) || 0, custo_recuperado: 0 } as any);
      const cid = uid();
      db.cobrancas.push({ id: cid, contrato_id: id, lead_id: leadId, numero: 1, tipo: n ? 'adesao' : 'avista', valor: v, vencimento: d.vencimento || isoDia(Date.now() + 2 * DIA), status: 'pendente', motivo_cancelamento: null, asaas_payment_id: 'pay_demo', invoice_url: 'https://www.asaas.com/i/demo' + cid.slice(0, 6), forma_paga: null, valor_pago: null, valor_liquido: null, valor_estornado: null, pago_em: null, erro: null, criado_em: new Date().toISOString() });
      for (let i = 1; i <= n; i++) db.cobrancas.push({ id: uid(), contrato_id: id, lead_id: leadId, numero: i + 1, tipo: 'parcela', valor: vp, vencimento: null, status: 'planejada', motivo_cancelamento: null, asaas_payment_id: null, invoice_url: null, forma_paga: null, valor_pago: null, valor_liquido: null, valor_estornado: null, pago_em: null, erro: null, criado_em: new Date().toISOString() });
      avisar('contratos'); return { ok: true, cobranca_id: cid };
    },
    async enviarLinkCobranca(id) { return this.reenviarLink(id); },
    async sair() { /* demo */ },
  };
}
