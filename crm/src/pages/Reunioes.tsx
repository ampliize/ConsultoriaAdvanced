import type { Ctx } from '../App';
import { dataHora, nomeLead, telefone } from '../lib/format';

const STATUS: Record<string, string> = { reservando: 'Reservando', agendada: 'Agendada', realizada: 'Realizada', no_show: 'Não compareceu', cancelada: 'Cancelada' };
const COR: Record<string, string> = { agendada: 'info', realizada: 'ok', no_show: 'bad', cancelada: 'gray', reservando: 'warn' };

export default function Reunioes({ ctx }: { ctx: Ctx }) {
  const agora = Date.now();
  const lista = [...ctx.snap.reunioes].sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
  const proximas = lista.filter(r => new Date(r.fim).getTime() >= agora && r.status === 'agendada');
  const passadas = lista.filter(r => !proximas.includes(r)).reverse();
  const mudar = async (id: string, status: string) => {
    await ctx.api.atualizarReuniao(id, { status });
    const r = ctx.snap.reunioes.find(x => x.id === id);
    if (status === 'realizada' && r) await ctx.api.moverEtapa(r.lead_id, 'concluido');
    ctx.toast('Reunião atualizada'); ctx.recarregar();
  };
  const Linha = ({ r }: any) => { const l = ctx.snap.leads.find(x => x.id === r.lead_id); return (
    <tr>
      <td className="b">{dataHora(r.inicio)}</td><td>{l ? nomeLead(l) : '—'}<div className="small muted">{l && telefone(l.telefone)}</div></td>
      <td>{r.meet_link ? <a href={r.meet_link} target="_blank" rel="noreferrer">Abrir Meet</a> : '—'}</td>
      <td><span className={'pill ' + (COR[r.status] || 'gray')}>{STATUS[r.status] || r.status}</span></td>
      <td><select className="input" value={r.status} onChange={e => mudar(r.id, e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
    </tr>); };
  const Tabela = ({ itens }: any) => <table><thead><tr><th>Quando</th><th>Lead</th><th>Google Meet</th><th>Status</th><th>Atualizar</th></tr></thead><tbody>{itens.map((r: any) => <Linha key={r.id} r={r} />)}</tbody></table>;
  return (
    <div className="page">
      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="lbl">Próximas reuniões</div><div className="val">{proximas.length}</div></div>
        <div className="card kpi"><div className="lbl">Realizadas</div><div className="val">{lista.filter(r => r.status === 'realizada').length}</div></div>
        <div className="card kpi"><div className="lbl">Não compareceram</div><div className="val">{lista.filter(r => r.status === 'no_show').length}</div></div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}><h3>Próximas</h3>{proximas.length ? <Tabela itens={proximas} /> : <div className="empty">Nenhuma reunião agendada.</div>}</div>
      <div className="card" style={{ marginTop: 14, overflowX: 'auto' }}><h3>Histórico</h3>{passadas.length ? <Tabela itens={passadas.slice(0, 100)} /> : <div className="empty">Sem histórico.</div>}</div>
    </div>
  );
}
