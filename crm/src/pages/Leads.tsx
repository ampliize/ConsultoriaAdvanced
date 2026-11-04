import { useMemo, useState } from 'react';
import type { Ctx } from '../App';
import { ETAPAS, etapaInfo } from '../lib/types';
import { brl, dataHora, nomeLead, telefone, SERVICO, ORIGEM } from '../lib/format';
import LeadPanel from '../components/LeadPanel';

export default function Leads({ ctx }: { ctx: Ctx }) {
  const [busca, setBusca] = useState(''); const [etapa, setEtapa] = useState(''); const [aberto, setAberto] = useState<string | null>(null);
  const lista = useMemo(() => ctx.snap.leads.filter(l => (!etapa || l.etapa === etapa) && (!busca || nomeLead(l).toLowerCase().includes(busca.toLowerCase()) || l.telefone.includes(busca.replace(/\D/g, '') || '§'))), [ctx.snap.leads, busca, etapa]);
  const lead = ctx.snap.leads.find(l => l.id === aberto);
  const exportar = () => {
    const cab = ['nome', 'telefone', 'email', 'servico', 'etapa', 'urgencia', 'origem', 'pagamento', 'valor', 'motivo_perda', 'entrada'];
    const linhas = lista.map(l => [nomeLead(l), l.telefone, l.email || '', l.servico, l.etapa, l.urgencia || '', l.origem, l.pagamento_status, l.valor_venda || '', l.motivo_perda || '', l.criado_em]);
    const csv = [cab, ...linhas].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'leads-advance.csv'; a.click();
  };
  return (
    <div className="page">
      <div className="toolbar">
        <input className="input" placeholder="Buscar nome ou telefone" value={busca} onChange={e => setBusca(e.target.value)} />
        <select className="input" value={etapa} onChange={e => setEtapa(e.target.value)}><option value="">Todas as etapas</option>{ETAPAS.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
        <span className="small muted">{lista.length} leads</span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={exportar}>Exportar CSV</button>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Lead</th><th>Telefone</th><th>Serviço</th><th>Etapa</th><th>Urgência</th><th>Origem</th><th>Pagamento</th><th>Entrada</th></tr></thead>
          <tbody>{lista.slice(0, 300).map(l => { const e = etapaInfo(l.etapa); return (
            <tr key={l.id} className="click" onClick={() => setAberto(l.id)}>
              <td className="b">{nomeLead(l)}</td><td>{telefone(l.telefone)}</td><td>{SERVICO[l.servico]}</td>
              <td><span className="chip" style={{ background: e.cor }}>{e.nome}</span></td><td>{l.urgencia || '—'}</td><td>{ORIGEM[l.origem] || l.origem}</td>
              <td>{l.pagamento_status === 'confirmado' ? brl(l.valor_venda) : l.pagamento_status === 'nenhum' ? '—' : l.pagamento_status.replace('_', ' ')}</td><td className="small">{dataHora(l.primeira_msg_em || l.criado_em)}</td>
            </tr>); })}</tbody>
        </table>
        {!lista.length && <div className="empty">Nenhum lead.</div>}
      </div>
      {lead && <div className="modal-bg" onClick={() => setAberto(null)}><div className="modal" style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <LeadPanel ctx={ctx} lead={lead} />
        <div className="row end" style={{ marginTop: 10 }}><button className="btn" onClick={() => { const c = ctx.snap.conversas.find(c => c.lead_id === lead.id); if (c) ctx.abrirConversa(c.id); }}>Abrir conversa</button><button className="btn" onClick={() => setAberto(null)}>Fechar</button></div>
      </div></div>}
    </div>
  );
}
