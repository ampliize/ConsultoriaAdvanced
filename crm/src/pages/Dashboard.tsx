import { useState } from 'react';
import { MessageCircle, UserCheck, CalendarCheck, TrendingDown, Timer, Wallet, Headset, Send } from 'lucide-react';
import type { Ctx } from '../App';
import { calcular, Periodo } from '../lib/metrics';
import { etapaInfo } from '../lib/types';
import { brl, duracao, num, pct, SERVICO, ORIGEM } from '../lib/format';

const MOTIVO: Record<string, string> = { sem_resposta: 'Parou de responder', preco: 'Preço', sem_interesse: 'Sem interesse', ja_resolveu: 'Já resolveu', quer_dinheiro_imediato: 'Quer dinheiro imediato', exige_garantia: 'Exige garantia judicial', perdao_divida: 'Quer perdão da dívida', sem_motivo: 'Sem motivo informado' };

function Kpi({ icon: I, lbl, val, hint, cor }: any) {
  return <div className="card kpi"><div className="lbl"><I size={15} color={cor || '#13315c'} /> {lbl}</div><div className="val">{val}</div>{hint && <div className="hint">{hint}</div>}</div>;
}

export default function Dashboard({ ctx }: { ctx: Ctx }) {
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const m = calcular(ctx.snap, periodo);
  const topo = Math.max(1, m.funil[0].qtd);
  const maxSerie = Math.max(1, ...m.serie.map(s => s.leads));
  const ativosAgora = ctx.snap.conversas.filter(c => c.ia_ativa && c.ultima_msg_em && Date.now() - new Date(c.ultima_msg_em).getTime() < 3600000).length;
  const humanosAgora = ctx.snap.conversas.filter(c => !c.ia_ativa).length;
  const perdasTot = Object.values(m.motivos).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="page">
      <div className="toolbar">
        <div className="seg">{(['hoje', '7d', '30d', 'tudo'] as Periodo[]).map(p => <button key={p} className={periodo === p ? 'on' : ''} onClick={() => setPeriodo(p)}>{{ hoje: 'Hoje', '7d': '7 dias', '30d': '30 dias', tudo: 'Tudo' }[p]}</button>)}</div>
        <span className="pill info"><span className="dot pulse" /> {ativosAgora} conversas com a IA na última hora</span>
        <span className="pill warn">{humanosAgora} com humano / aguardando</span>
      </div>

      <div className="grid g4">
        <Kpi icon={MessageCircle} lbl="Atendimentos da IA" val={num(m.atendimentos)} hint={`${num(m.respondidos)} respondidos (${pct(m.respondidos, m.atendimentos)})`} />
        <Kpi icon={UserCheck} lbl="Leads qualificados" val={num(m.qualificados)} hint={`${pct(m.qualificados, m.atendimentos)} dos atendimentos`} cor="#8b5cf6" />
        <Kpi icon={CalendarCheck} lbl="Reuniões agendadas" val={num(m.agendados)} hint={`${pct(m.agendados, m.atendimentos)} de conversão`} cor="#0ea5e9" />
        <Kpi icon={TrendingDown} lbl="Perderam o interesse" val={num(m.perdidos)} hint={`+ ${num(m.desqualificados)} fora do perfil`} cor="#ef4444" />
        <Kpi icon={Timer} lbl="Tempo médio da 1ª resposta" val={duracao(m.tempoMedio)} hint="meta: imediato (24/7)" cor="#10b981" />
        <Kpi icon={Wallet} lbl="Vendas confirmadas" val={brl(m.receita)} hint={`${num(m.pagos)} pagamentos · ${num(m.propostas)} propostas`} cor="#059669" />
        <Kpi icon={Headset} lbl="Transferências p/ humano" val={num(m.transferencias)} hint={`${pct(m.transferencias, m.atendimentos)} dos atendimentos`} cor="#f59e0b" />
        <Kpi icon={Send} lbl="Mensagens enviadas" val={num(m.msgIa + m.msgHumano)} hint={`IA ${num(m.msgIa)} · humano ${num(m.msgHumano)} · recebidas ${num(m.msgLead)}`} />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Funil de qualificação <span className="sub">leads que chegaram em cada etapa</span></h3>
          {m.funil.map((f, i) => {
            const info = etapaInfo(f.etapa); const w = Math.max(3, (f.qtd / topo) * 100);
            return (
              <div className="funnel-row" key={f.etapa}>
                <div className="small b">{info.nome}</div>
                <div className="funnel-bar"><span style={{ width: w + '%', background: info.cor }}>{num(f.qtd)}</span></div>
                <div className="conv">{i === 0 ? '100%' : pct(f.qtd, m.funil[i - 1].qtd) + ' ← '}</div>
              </div>
            );
          })}
          <div className="small muted" style={{ marginTop: 8 }}>Conversão total (entrada → reunião agendada): <b>{pct(m.funil[5].qtd, topo)}</b></div>
        </div>
        <div className="card">
          <h3>Leads por dia <span className="sub legend"><span><i style={{ background: '#13315c' }} />novos</span><span><i style={{ background: '#d4a24c' }} />qualificados</span></span></h3>
          <div className="bars">
            {m.serie.map(s => (
              <div className="col" key={s.dia} title={`${s.dia}: ${s.leads} novos · ${s.qualificados} qualificados · ${s.agendados} agendados`}>
                <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', width: '100%', height: 130 }}>
                  <div className="b" style={{ height: (s.leads / maxSerie) * 100 + '%', flex: 1 }} />
                  <div className="b b2" style={{ height: (s.qualificados / maxSerie) * 100 + '%', flex: 1 }} />
                </div>
                {(m.serie.length <= 10 || m.serie.indexOf(s) % 5 === 0) && <div className="lbl">{s.dia}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Por serviço</h3>
          {Object.entries(m.porServico).map(([k, v]) => (
            <div className="list-row" key={k}><span>{SERVICO[k] || k}</span><span><b>{v.leads}</b> leads · {v.pagos} pagos · {brl(v.receita)}</span></div>
          ))}
          {!Object.keys(m.porServico).length && <div className="muted small">Sem dados no período.</div>}
        </div>
        <div className="card">
          <h3>Por que perdemos</h3>
          {Object.entries(m.motivos).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div key={k} style={{ margin: '6px 0' }}>
              <div className="row small"><span>{MOTIVO[k] || k}</span><b style={{ marginLeft: 'auto' }}>{v}</b></div>
              <div className="funnel-bar" style={{ height: 6 }}><span style={{ width: (v / perdasTot) * 100 + '%', background: '#ef4444' }} /></div>
            </div>
          ))}
          {!Object.keys(m.motivos).length && <div className="muted small">Nenhuma perda no período.</div>}
        </div>
        <div className="card">
          <h3>Origem dos leads</h3>
          {Object.entries(m.porOrigem).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div className="list-row" key={k}><span>{ORIGEM[k] || k}</span><span><b>{v}</b> ({pct(v, m.atendimentos)})</span></div>
          ))}
          {!Object.keys(m.porOrigem).length && <div className="muted small">Sem dados no período.</div>}
        </div>
      </div>
    </div>
  );
}
