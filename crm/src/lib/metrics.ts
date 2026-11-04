import type { Snapshot } from './api';
import { FUNIL, ordemEtapa } from './types';

export type Periodo = 'hoje' | '7d' | '30d' | 'tudo';
export function inicioPeriodo(p: Periodo): Date | null {
  const agora = new Date();
  if (p === 'tudo') return null;
  if (p === 'hoje') { const d = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Maceio' })); d.setHours(0, 0, 0, 0); return new Date(agora.getTime() - (new Date(agora.toLocaleString('en-US', { timeZone: 'America/Maceio' })).getTime() - d.getTime())); }
  return new Date(agora.getTime() - (p === '7d' ? 7 : 30) * 86400000);
}

const dentro = (s: string | null | undefined, ini: Date | null) => !!s && (!ini || new Date(s) >= ini);

export function calcular(s: Snapshot, p: Periodo) {
  const ini = inicioPeriodo(p);
  const leadsP = s.leads.filter(l => dentro(l.primeira_msg_em || l.criado_em, ini));
  // etapa máxima alcançada por lead (histórico do funil)
  const max = new Map<string, number>();
  s.eventos.forEach(e => { const o = ordemEtapa(e.etapa_para); if (o >= 0) max.set(e.lead_id, Math.max(max.get(e.lead_id) ?? -1, o)); });
  s.leads.forEach(l => { const o = ordemEtapa(l.etapa); if (o >= 0) max.set(l.id, Math.max(max.get(l.id) ?? -1, o)); });
  const alcancou = (k: number) => leadsP.filter(l => (max.get(l.id) ?? 0) >= k || (k <= 1 && !!l.primeira_resposta_em)).length;
  const funil = FUNIL.map((e, k) => ({ etapa: e, qtd: k === 0 ? leadsP.length : alcancou(k) }));

  const atendimentos = leadsP.length;
  const respondidos = leadsP.filter(l => l.primeira_resposta_em).length;
  const tempos = leadsP.filter(l => l.primeira_resposta_em && l.primeira_msg_em).map(l => new Date(l.primeira_resposta_em!).getTime() - new Date(l.primeira_msg_em!).getTime()).filter(x => x >= 0);
  const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : NaN;
  const qualificados = s.leads.filter(l => dentro(l.qualificado_em, ini)).length;
  const propostas = s.leads.filter(l => dentro(l.proposta_em, ini)).length;
  const pagos = s.leads.filter(l => l.pagamento_status === 'confirmado' && dentro(l.pago_em, ini));
  const receita = pagos.reduce((a, l) => a + (Number(l.valor_venda) || 0), 0);
  const agendados = s.reunioes.filter(r => r.status !== 'cancelada' && dentro((r as any).criado_em || r.inicio, ini)).length;
  const perdidos = s.leads.filter(l => l.etapa === 'perdido' && dentro(l.perdido_em, ini));
  const desqualificados = s.leads.filter(l => l.etapa === 'desqualificado' && dentro(l.perdido_em, ini));
  const transferencias = s.alertas.filter(a => a.tipo === 'handoff' && dentro(a.criado_em, ini)).length;
  const msgIa = s.mensagens.filter(m => m.autor === 'ia' && dentro(m.criado_em, ini)).length;
  const msgHumano = s.mensagens.filter(m => m.autor === 'humano' && dentro(m.criado_em, ini)).length;
  const msgLead = s.mensagens.filter(m => m.autor === 'lead' && dentro(m.criado_em, ini)).length;

  const motivos: Record<string, number> = {};
  [...perdidos, ...desqualificados].forEach(l => { const k = l.motivo_perda || 'sem_motivo'; motivos[k] = (motivos[k] || 0) + 1; });
  const porServico: Record<string, { leads: number; pagos: number; receita: number }> = {};
  leadsP.forEach(l => { const k = l.servico; porServico[k] ??= { leads: 0, pagos: 0, receita: 0 }; porServico[k].leads++; });
  pagos.forEach(l => { const k = l.servico; porServico[k] ??= { leads: 0, pagos: 0, receita: 0 }; porServico[k].pagos++; porServico[k].receita += Number(l.valor_venda) || 0; });
  const porOrigem: Record<string, number> = {};
  leadsP.forEach(l => { porOrigem[l.origem] = (porOrigem[l.origem] || 0) + 1; });

  // série diária (últimos N dias)
  const dias = p === 'hoje' ? 1 : p === '7d' ? 7 : 30;
  const serie: { dia: string; leads: number; qualificados: number; agendados: number }[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toLocaleDateString('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' });
    serie.push({ dia: d, leads: 0, qualificados: 0, agendados: 0 });
  }
  const idx = (s2: string | null) => s2 ? serie.findIndex(x => x.dia === new Date(s2).toLocaleDateString('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' })) : -1;
  s.leads.forEach(l => { let i = idx(l.primeira_msg_em || l.criado_em); if (i >= 0) serie[i].leads++; i = idx(l.qualificado_em); if (i >= 0) serie[i].qualificados++; i = idx(l.agendado_em); if (i >= 0) serie[i].agendados++; });

  return { atendimentos, respondidos, tempoMedio, qualificados, propostas, pagos: pagos.length, receita, agendados,
    perdidos: perdidos.length, desqualificados: desqualificados.length, transferencias, msgIa, msgHumano, msgLead,
    funil, motivos, porServico, porOrigem, serie };
}
