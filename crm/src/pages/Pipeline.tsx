import { useState } from 'react';
import type { Ctx } from '../App';
import { ETAPAS, Etapa } from '../lib/types';
import { brl, nomeLead, relativo, SERVICO } from '../lib/format';

export default function Pipeline({ ctx }: { ctx: Ctx }) {
  const [servico, setServico] = useState('todos');
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const leads = ctx.snap.leads.filter(l => servico === 'todos' || l.servico === servico);
  const soltar = async (etapa: Etapa) => {
    setSobre(null); if (!arrastando) return;
    const l = ctx.snap.leads.find(x => x.id === arrastando); setArrastando(null);
    if (!l || l.etapa === etapa) return;
    const motivo = etapa === 'perdido' || etapa === 'desqualificado' ? prompt('Motivo?') || undefined : undefined;
    await ctx.api.moverEtapa(l.id, etapa, motivo); ctx.toast(`${nomeLead(l)} → ${ETAPAS.find(e => e.id === etapa)!.nome}`); ctx.recarregar();
  };
  return (
    <div className="page">
      <div className="toolbar">
        <div className="seg">{[['todos', 'Os dois funis'], ['diagnostico', 'Funil Diagnóstico'], ['limpa_nome', 'Funil Limpa Nome']].map(([k, n]) => <button key={k} className={servico === k ? 'on' : ''} onClick={() => setServico(k)}>{n}</button>)}</div>
        <span className="small muted">Arraste os cards para mudar a etapa. Clique para abrir a conversa.</span>
      </div>
      <div className="kanban">
        {ETAPAS.map(e => {
          const doEstagio = leads.filter(l => l.etapa === e.id);
          const valor = doEstagio.reduce((a, l) => a + (Number(l.valor_venda || l.valor_previsto) || 0), 0);
          return (
            <div key={e.id} className={'kcol' + (sobre === e.id ? ' drop' : '')} onDragOver={ev => { ev.preventDefault(); setSobre(e.id); }} onDragLeave={() => setSobre(null)} onDrop={() => soltar(e.id)} style={{ ['--cor' as any]: e.cor }}>
              <h4><span className="dot" style={{ color: e.cor }} />{e.nome}<b>{doEstagio.length}</b></h4>
              {valor > 0 && <div className="small muted" style={{ margin: '-6px 4px 8px' }}>{brl(valor)}</div>}
              {doEstagio.slice(0, 60).map(l => (
                <div key={l.id} className="kcard" draggable onDragStart={() => setArrastando(l.id)} onClick={() => { const c = ctx.snap.conversas.find(c => c.lead_id === l.id); if (c) ctx.abrirConversa(c.id); }}>
                  <div className="n">{nomeLead(l)}</div>
                  <div className="m"><span>{SERVICO[l.servico]}</span>{l.urgencia && <span>· urgência {l.urgencia}</span>}<span>· {relativo(l.atualizado_em)}</span></div>
                  {l.motivo_perda && <div className="m">motivo: {l.motivo_perda}</div>}
                </div>
              ))}
              {doEstagio.length > 60 && <div className="small muted">+{doEstagio.length - 60} leads</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
