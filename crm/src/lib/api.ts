import { sb, anonKey } from './supabase';

export const WHATSAPP_URL = (import.meta.env.VITE_N8N_WHATSAPP_URL as string) || 'https://n8n-n8n.dgwpoe.easypanel.host/webhook/adv-whatsapp-conexao-h3n8v2';
export const ENVIAR_URL = (import.meta.env.VITE_N8N_ENVIAR_URL as string) || 'https://n8n-n8n.dgwpoe.easypanel.host/webhook/adv-crm-enviar-p6r2t9';
export interface WhatsappResp { ok: boolean; estado?: string; qr?: string | null; pairing?: string | null; erro?: string | null; detalhe?: string | null; instancia?: string }
import type { Alerta, ConfigRow, Conversa, Evento, Lead, Mensagem, Reuniao, Etapa, Contrato, Cobranca, Comissao, Notificacao } from './types';

export interface MsgResumo { autor: string; criado_em: string; conversa_id: string; direcao: string }
export interface Snapshot {
  leads: Lead[]; conversas: Conversa[]; reunioes: Reuniao[]; eventos: Evento[]; alertas: Alerta[];
  config: Record<string, ConfigRow>; mensagens: MsgResumo[];
  contratos: Contrato[]; cobrancas: Cobranca[]; comissoes: Comissao[]; notificacoes: Notificacao[];
}
export interface Resultado { ok: boolean; erro?: string; [k: string]: any }
export interface CrmUsuario { email: string; nome: string | null; papel: string; ativo: boolean }

export interface Api {
  demo: boolean;
  email(): string;
  carregar(desde: string | null): Promise<Snapshot>;
  mensagens(conversaId: string): Promise<Mensagem[]>;
  pausaGeral(pausar: boolean, motivo?: string): Promise<void>;
  assumir(conversaId: string): Promise<void>;
  devolver(conversaId: string): Promise<void>;
  moverEtapa(leadId: string, etapa: Etapa, motivo?: string): Promise<void>;
  confirmarPagamento(leadId: string, valor: number, forma: string): Promise<void>;
  atualizarLead(id: string, patch: Partial<Lead>): Promise<void>;
  atualizarReuniao(id: string, patch: Partial<Reuniao>): Promise<void>;
  salvarConfig(chave: string, valor: any): Promise<void>;
  marcarAlertasLidos(): Promise<void>;
  usuarios(): Promise<CrmUsuario[]>;
  salvarUsuario(u: CrmUsuario): Promise<void>;
  assinar(onChange: (tabela: string) => void): () => void;
  whatsapp(acao: 'status' | 'conectar' | 'desconectar'): Promise<WhatsappResp>;
  enviarMensagem(conversaId: string, texto: string): Promise<{ ok: boolean; erro?: string | null }>;
  criarContrato(leadId: string, servico: string, modalidade: string): Promise<Resultado>;
  quitar(contratoId: string, desconto: number, motivo: string): Promise<Resultado>;
  andamento(contratoId: string, etapa: string, detalhe: string, enviar: boolean): Promise<Resultado>;
  reenviarLink(cobrancaId: string): Promise<Resultado>;
  gerarCobranca(leadId: string, dados: Record<string, any>): Promise<Resultado>;
  enviarLinkCobranca(cobrancaId: string): Promise<Resultado>;
  sair(): Promise<void>;
}

const check = (r: { error: any }) => { if (r.error) throw new Error(r.error.message || String(r.error)); };
// numeric do Postgres chega como texto: converte os campos de valor
const NUM = ['valor', 'valor_total', 'pago', 'saldo_devedor', 'vencido', 'valor_pago', 'valor_liquido', 'valor_estornado', 'base', 'percentual', 'desconto_quitacao', 'pagamentos_feitos', 'pagamentos_total', 'custo_produto', 'custo_recuperado', 'custo_alocado'];
const n = <T,>(o: T): T => { const x: any = { ...o }; for (const k of NUM) if (x[k] != null) x[k] = Number(x[k]); return x; };
// o servidor entrega no máximo 1.000 linhas por consulta: busca em páginas até acabar
const PAGINA = 1000;
async function tudo(montar: (de: number, ate: number) => any, max: number) {
  const linhas: any[] = [];
  for (let de = 0; de < max; de += PAGINA) {
    const r = await montar(de, Math.min(de + PAGINA, max) - 1);
    if (r.error) return r;
    linhas.push(...(r.data || []));
    if (!r.data || r.data.length < PAGINA) break;
  }
  return { data: linhas, error: null };
}
// falha de rede (Wi-Fi oscilando, aba em segundo plano): tenta de novo antes de desistir
async function comRetentativa<T>(f: () => Promise<T>, tentativas = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); }
    catch (e: any) {
      const rede = e instanceof TypeError || /fetch|network|Load failed/i.test(String(e?.message));
      if (!rede || i >= tentativas - 1) throw e;
      await new Promise(ok => setTimeout(ok, 800 * 2 ** i));
    }
  }
}
const rpc = async (c: any, nome: string, args: any) => { const r = await c.rpc(nome, args); check(r); return (r.data || { ok: false }) as Resultado; };

export function apiSupabase(email: string): Api {
  const c = sb();
  return {
    demo: false,
    email: () => email,
    async carregar(desde) {
      const desdeQ = desde || '2000-01-01';
      const [leads, conversas, reunioes, eventos, alertas, config, mensagens, contratos, cobrancas, comissoes, notificacoes] = await comRetentativa(() => Promise.all([
        tudo((a, b) => c.from('leads').select('*').order('criado_em', { ascending: false }).order('id').range(a, b), 20000),
        tudo((a, b) => c.from('vw_conversas').select('*').order('ultima_msg_em', { ascending: false, nullsFirst: false }).order('id').range(a, b), 20000),
        tudo((a, b) => c.from('reunioes').select('*').order('inicio', { ascending: true }).order('id').range(a, b), 5000),
        tudo((a, b) => c.from('eventos_funil').select('*').gte('criado_em', desdeQ).order('id').range(a, b), 50000),
        c.from('alertas').select('*').order('criado_em', { ascending: false }).limit(200),
        c.from('config').select('*'),
        tudo((a, b) => c.from('mensagens').select('autor,criado_em,conversa_id,direcao').gte('criado_em', desdeQ).order('id').range(a, b), 100000),
        tudo((a, b) => c.from('vw_contratos').select('*').order('criado_em', { ascending: false }).order('id').range(a, b), 20000),
        tudo((a, b) => c.from('cobrancas').select('*').order('id').range(a, b), 60000),
        tudo((a, b) => c.from('comissoes').select('*').order('id').range(a, b), 100000),
        c.from('notificacoes').select('*').order('criado_em', { ascending: false }).limit(3000),
      ]));
      [leads, conversas, reunioes, eventos, alertas, config, mensagens, contratos, cobrancas, comissoes, notificacoes].forEach(check);
      return {
        leads: leads.data as Lead[], conversas: conversas.data as Conversa[], reunioes: reunioes.data as Reuniao[],
        eventos: eventos.data as Evento[], alertas: alertas.data as Alerta[], mensagens: mensagens.data as MsgResumo[],
        config: Object.fromEntries((config.data as ConfigRow[]).map(r => [r.chave, r])),
        contratos: (contratos.data as Contrato[]).map(n), cobrancas: (cobrancas.data as Cobranca[]).map(n),
        comissoes: (comissoes.data as Comissao[]).map(n), notificacoes: notificacoes.data as Notificacao[],
      };
    },
    async mensagens(id) {
      const r = await c.from('mensagens').select('*').eq('conversa_id', id).order('id').limit(500); check(r); return r.data as Mensagem[];
    },
    async pausaGeral(pausar, motivo) { check(await c.rpc('crm_pausa_geral', { p_pausar: pausar, p_motivo: motivo || null })); },
    async assumir(id) { check(await c.rpc('crm_assumir', { p_conversa: id })); },
    async devolver(id) { check(await c.rpc('crm_devolver_ia', { p_conversa: id })); },
    async moverEtapa(lead, etapa, motivo) { check(await c.rpc('crm_mover_etapa', { p_lead: lead, p_etapa: etapa, p_motivo: motivo || null })); },
    async confirmarPagamento(lead, valor, forma) { check(await c.rpc('crm_confirmar_pagamento', { p_lead: lead, p_valor: valor, p_forma: forma })); },
    async atualizarLead(id, patch) { check(await c.from('leads').update(patch).eq('id', id)); },
    async atualizarReuniao(id, patch) { check(await c.from('reunioes').update(patch).eq('id', id)); },
    async salvarConfig(chave, valor) {
      check(await c.from('config').upsert({ chave, valor, atualizado_em: new Date().toISOString(), atualizado_por: email }));
    },
    async marcarAlertasLidos() { check(await c.from('alertas').update({ lido: true }).eq('lido', false)); },
    async usuarios() { const r = await c.from('crm_usuarios').select('*').order('email'); check(r); return r.data as CrmUsuario[]; },
    async salvarUsuario(u) { check(await c.from('crm_usuarios').upsert({ ...u, email: u.email.toLowerCase().trim() })); },
    assinar(onChange) {
      const ch = c.channel('crm-advance');
      ['mensagens', 'conversas', 'leads', 'config', 'alertas', 'contratos', 'cobrancas', 'notificacoes'].forEach(t =>
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => onChange(t)));
      ch.subscribe();
      return () => { c.removeChannel(ch); };
    },
    async whatsapp(acao) {
      const { data } = await c.auth.getSession();
      const r = await fetch(WHATSAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey() || '', Authorization: 'Bearer ' + (data.session?.access_token || '') },
        body: JSON.stringify({ acao }),
      });
      const txt = await r.text();
      let j: any = {}; try { j = JSON.parse(txt); } catch { j = { ok: false, erro: txt || `HTTP ${r.status}` }; }
      if (!r.ok && !j.erro) j.erro = `HTTP ${r.status}`;
      return j as WhatsappResp;
    },
    async enviarMensagem(conversaId, texto) {
      const { data } = await c.auth.getSession();
      const r = await fetch(ENVIAR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey() || '', Authorization: 'Bearer ' + (data.session?.access_token || '') },
        body: JSON.stringify({ conversa_id: conversaId, texto }),
      });
      const txt = await r.text();
      let j: any = {}; try { j = JSON.parse(txt); } catch { j = { ok: false, erro: txt || `HTTP ${r.status}` }; }
      if (!r.ok && !j.erro) j.erro = `HTTP ${r.status}`;
      return j;
    },
    criarContrato: (lead, servico, modalidade) => rpc(c, 'crm_criar_contrato', { p_lead: lead, p_servico: servico, p_modalidade: modalidade }),
    quitar: (id, desconto, motivo) => rpc(c, 'crm_quitar_contrato', { p_contrato: id, p_desconto: desconto, p_motivo: motivo || null }),
    andamento: (id, etapa, detalhe, enviar) => rpc(c, 'crm_andamento_processo', { p_contrato: id, p_etapa: etapa, p_detalhe: detalhe || null, p_enviar: enviar }),
    reenviarLink: (id) => rpc(c, 'crm_reenviar_link', { p_cobranca: id }),
    gerarCobranca: (lead, dados) => rpc(c, 'crm_gerar_cobranca', { p_lead: lead, p: dados }),
    enviarLinkCobranca: (id) => rpc(c, 'crm_enviar_link_cobranca', { p_cobranca: id }),
    async sair() { await c.auth.signOut(); },
  };
}
