import { useEffect, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import type { Ctx } from '../App';

const DIAS = [
  { n: 1, nome: 'Seg' }, { n: 2, nome: 'Ter' }, { n: 3, nome: 'Qua' }, { n: 4, nome: 'Qui' },
  { n: 5, nome: 'Sex' }, { n: 6, nome: 'Sáb' }, { n: 7, nome: 'Dom' },
];
const PADRAO = { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00', almoco: ['12:00', '13:30'], duracao_min: 30, antecedencia_horas: 2, dias_a_frente: 7, bloqueios: [] as string[] };

export default function AgendaEditor({ ctx }: { ctx: Ctx }) {
  const atual = { ...PADRAO, ...(ctx.snap.config.agenda_closer?.valor || {}) };
  const [a, setA] = useState(atual);
  const [temAlmoco, setTemAlmoco] = useState(!!atual.almoco && atual.almoco[0] !== atual.almoco[1]);
  const [novaData, setNovaData] = useState('');
  const [cal, setCal] = useState<string>(ctx.snap.config.google_calendar_id?.valor || 'primary');
  const [erro, setErro] = useState('');
  useEffect(() => { setA({ ...PADRAO, ...(ctx.snap.config.agenda_closer?.valor || {}) }); }, [JSON.stringify(ctx.snap.config.agenda_closer?.valor)]);

  const set = (k: string, v: any) => setA({ ...a, [k]: v });
  const alternarDia = (n: number) => set('dias', a.dias.includes(n) ? a.dias.filter((d: number) => d !== n) : [...a.dias, n].sort());
  const salvar = async () => {
    if (!a.dias.length) return setErro('Escolha pelo menos um dia de atendimento.');
    if (a.inicio >= a.fim) return setErro('O horário de término precisa ser depois do início.');
    if (temAlmoco && a.almoco[0] >= a.almoco[1]) return setErro('O fim do almoço precisa ser depois do início.');
    setErro('');
    await ctx.api.salvarConfig('agenda_closer', { ...a, almoco: temAlmoco ? a.almoco : ['00:00', '00:00'], duracao_min: Number(a.duracao_min), antecedencia_horas: Number(a.antecedencia_horas), dias_a_frente: Number(a.dias_a_frente) });
    await ctx.api.salvarConfig('google_calendar_id', cal.trim() || 'primary');
    ctx.toast('Agenda do especialista salva'); ctx.recarregar();
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h3><CalendarDays size={16} /> Agenda do especialista <span className="sub">horários que a IA pode oferecer para a reunião no Meet</span></h3>
      <div className="field"><label>Dias de atendimento</label>
        <div className="row wrap">{DIAS.map(d => (
          <button key={d.n} type="button" className={'btn sm' + (a.dias.includes(d.n) ? ' primary' : '')} onClick={() => alternarDia(d.n)}>{d.nome}</button>
        ))}</div>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field"><label>Começa às</label><input className="input" type="time" value={a.inicio} onChange={e => set('inicio', e.target.value)} /></div>
        <div className="field"><label>Termina às</label><input className="input" type="time" value={a.fim} onChange={e => set('fim', e.target.value)} /></div>
        <div className="field"><label>Duração da reunião</label>
          <select className="input" value={a.duracao_min} onChange={e => set('duracao_min', e.target.value)}>
            {[15, 20, 30, 45, 60, 90].map(m => <option key={m} value={m}>{m} minutos</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label><input type="checkbox" checked={temAlmoco} onChange={e => setTemAlmoco(e.target.checked)} /> Pausa para almoço</label>
        {temAlmoco && <div className="row wrap">
          <span className="small">das</span><input className="input" type="time" value={a.almoco[0]} onChange={e => set('almoco', [e.target.value, a.almoco[1]])} />
          <span className="small">às</span><input className="input" type="time" value={a.almoco[1]} onChange={e => set('almoco', [a.almoco[0], e.target.value])} />
        </div>}
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field"><label>Antecedência mínima</label>
          <select className="input" value={a.antecedencia_horas} onChange={e => set('antecedencia_horas', e.target.value)}>
            {[1, 2, 3, 4, 6, 12, 24, 48].map(h => <option key={h} value={h}>{h < 24 ? `${h} hora${h > 1 ? 's' : ''}` : `${h / 24} dia${h > 24 ? 's' : ''}`} antes</option>)}
          </select>
        </div>
        <div className="field"><label>Oferecer horários até</label>
          <select className="input" value={a.dias_a_frente} onChange={e => set('dias_a_frente', e.target.value)}>
            {[3, 5, 7, 10, 14, 21, 30].map(d => <option key={d} value={d}>{d} dias à frente</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>Dias sem atendimento (feriados, folgas)</label>
        <div className="row wrap">
          <input className="input" type="date" value={novaData} onChange={e => setNovaData(e.target.value)} />
          <button type="button" className="btn sm" onClick={() => { if (novaData && !a.bloqueios.includes(novaData)) set('bloqueios', [...a.bloqueios, novaData].sort()); setNovaData(''); }}>Adicionar</button>
        </div>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {a.bloqueios.map((d: string) => (
            <span key={d} className="pill gray">{d.split('-').reverse().join('/')}
              <button type="button" onClick={() => set('bloqueios', a.bloqueios.filter((x: string) => x !== d))} style={{ border: 0, background: 'none', padding: 0, display: 'flex' }} title="Remover"><X size={12} /></button></span>
          ))}
          {!a.bloqueios.length && <span className="small muted">Nenhum dia bloqueado.</span>}
        </div>
      </div>
      <div className="field"><label>Agenda do Google usada</label>
        <input className="input" value={cal} onChange={e => setCal(e.target.value)} />
        <span className="small muted">Deixe <b>primary</b> para usar a agenda principal da conta Google do especialista.</span>
      </div>
      {erro && <div className="err">{erro}</div>}
      <button className="btn primary" onClick={salvar}>Salvar agenda</button>
    </div>
  );
}
