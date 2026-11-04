import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import type { Lead, Etapa } from '../lib/types';
import { ETAPAS } from '../lib/types';
import { brl, dataHora, telefone, SERVICO, ORIGEM } from '../lib/format';

export default function LeadPanel({ ctx, lead }: { ctx: Ctx; lead: Lead }) {
  const [form, setForm] = useState({ nome: lead.nome || '', email: lead.email || '', observacoes: lead.observacoes || '' });
  const [pgto, setPgto] = useState<{ valor: string; forma: string } | null>(null);
  useEffect(() => setForm({ nome: lead.nome || '', email: lead.email || '', observacoes: lead.observacoes || '' }), [lead.id]);
  const reuniao = ctx.snap.reunioes.filter(r => r.lead_id === lead.id && r.status !== 'cancelada').slice(-1)[0];
  const salvar = async () => { await ctx.api.atualizarLead(lead.id, { nome: form.nome || null, email: form.email || null, observacoes: form.observacoes || null }); ctx.toast('Lead atualizado'); ctx.recarregar(); };
  const mover = async (e: Etapa) => {
    let motivo: string | undefined;
    if (e === 'perdido' || e === 'desqualificado') motivo = prompt('Motivo da perda?') || undefined;
    await ctx.api.moverEtapa(lead.id, e, motivo); ctx.toast('Etapa alterada'); ctx.recarregar();
  };
  return (
    <div>
      <div className="b" style={{ fontSize: 16 }}>{lead.nome || lead.nome_whatsapp || 'Sem nome'}</div>
      <div className="small muted" style={{ marginBottom: 12 }}><a href={`https://wa.me/${lead.telefone}`} target="_blank" rel="noreferrer">{telefone(lead.telefone)}</a> · {ORIGEM[lead.origem] || lead.origem}{lead.anuncio?.titulo ? ` · “${lead.anuncio.titulo}”` : ''}</div>
      <div className="field"><label>Etapa do funil</label>
        <select className="input" value={lead.etapa} onChange={e => mover(e.target.value as Etapa)}>{ETAPAS.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
        {lead.motivo_perda && <span className="small muted">Motivo: {lead.motivo_perda}</span>}
      </div>
      <div className="grid g2" style={{ gap: 8 }}>
        <div className="field"><label>Serviço</label><b>{SERVICO[lead.servico]}</b></div>
        <div className="field"><label>Urgência</label><b>{lead.urgencia || '—'}</b></div>
        <div className="field"><label>CPF/CNPJ</label><b>{lead.cpf_cnpj ? '✔ informado' : '—'}</b></div>
        <div className="field"><label>LGPD</label><b>{lead.consentimento_lgpd_em ? '✔ aceito' : '—'}</b></div>
        <div className="field"><label>Documento</label><b>{lead.documento_recebido ? '✔ recebido' : '—'}</b></div>
        <div className="field"><label>Pagamento</label><b>{{ nenhum: '—', link_enviado: 'Link enviado', informado: 'Informado (conferir)', confirmado: 'Confirmado' }[lead.pagamento_status]}</b></div>
      </div>
      {lead.valor_venda ? <div className="small" style={{ marginBottom: 10 }}>Venda: <b>{brl(lead.valor_venda)}</b> ({lead.forma_pagamento})</div> : null}
      {lead.pagamento_status !== 'confirmado' && (pgto ? (
        <div className="card" style={{ padding: 10, marginBottom: 10 }}>
          <div className="row"><input className="input" style={{ width: 90 }} value={pgto.valor} onChange={e => setPgto({ ...pgto, valor: e.target.value })} />
            <select className="input" value={pgto.forma} onChange={e => setPgto({ ...pgto, forma: e.target.value })}><option value="avista">À vista</option><option value="tap">TAP</option></select>
            <button className="btn ok sm" onClick={async () => { await ctx.api.confirmarPagamento(lead.id, Number(pgto.valor.replace(',', '.')), pgto.forma); setPgto(null); ctx.toast('Pagamento confirmado — a IA segue com documento e reunião'); ctx.recarregar(); }}>Confirmar</button></div>
        </div>
      ) : <button className="btn sm" style={{ marginBottom: 10 }} onClick={() => setPgto({ valor: String(lead.valor_previsto || (lead.servico === 'limpa_nome' ? 797 : 67)), forma: lead.forma_pagamento || 'avista' })}>Marcar como pago</button>)}
      {reuniao && <div className="card" style={{ padding: 10, marginBottom: 10 }}><div className="small muted">Reunião ({reuniao.status})</div><b>{dataHora(reuniao.inicio)}</b>{reuniao.meet_link && <div><a href={reuniao.meet_link} target="_blank" rel="noreferrer">{reuniao.meet_link}</a></div>}</div>}
      {lead.resumo && <div className="field"><label>Resumo da IA</label><div className="small">{lead.resumo}</div></div>}
      <div className="field"><label>Nome completo</label><input className="input" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
      <div className="field"><label>E-mail</label><input className="input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
      <div className="field"><label>Observações da equipe</label><textarea className="input" rows={3} value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} /></div>
      <button className="btn primary sm" onClick={salvar}>Salvar</button>
      <div className="small muted" style={{ marginTop: 12 }}>Entrou em {dataHora(lead.primeira_msg_em || lead.criado_em)}</div>
    </div>
  );
}
