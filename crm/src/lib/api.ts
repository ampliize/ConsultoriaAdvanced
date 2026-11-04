import { sb } from './supabase';
import type { Alerta, ConfigRow, Conversa, Evento, Lead, Mensagem, Reuniao, Etapa } from './types';

export interface MsgResumo { autor: string; criado_em: string; conversa_id: string; direcao: string }
export interface Snapshot {
  leads: Lead[]; conversas: Conversa[]; reunioes: Reuniao[]; eventos: Evento[]; alertas: Alerta[];
  config: Record<string, ConfigRow>; mensagens: MsgResumo[];
}
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
  sair(): Promise<void>;
}

const check = (r: { error: any }) => { if (r.error) throw new Error(r.error.message || String(r.error)); };

export function apiSupabase(email: string): Api {
  const c = sb();
  return {
    demo: false,
    email: () => email,
    async carregar(desde) {
      const desdeQ = desde || '2000-01-01';
      const [leads, conversas, reunioes, eventos, alertas, config, mensagens] = await Promise.all([
        c.from('leads').select('*').order('criado_em', { ascending: false }).limit(5000),
        c.from('vw_conversas').select('*').order('ultima_msg_em', { ascending: false, nullsFirst: false }).limit(1000),
        c.from('reunioes').select('*').order('inicio', { ascending: true }).limit(2000),
        c.from('eventos_funil').select('*').gte('criado_em', desdeQ).order('criado_em').limit(20000),
        c.from('alertas').select('*').order('criado_em', { ascending: false }).limit(200),
        c.from('config').select('*'),
        c.from('mensagens').select('autor,criado_em,conversa_id,direcao').gte('criado_em', desdeQ).limit(50000),
      ]);
      [leads, conversas, reunioes, eventos, alertas, config, mensagens].forEach(check);
      return {
        leads: leads.data as Lead[], conversas: conversas.data as Conversa[], reunioes: reunioes.data as Reuniao[],
        eventos: eventos.data as Evento[], alertas: alertas.data as Alerta[], mensagens: mensagens.data as MsgResumo[],
        config: Object.fromEntries((config.data as ConfigRow[]).map(r => [r.chave, r])),
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
      ['mensagens', 'conversas', 'leads', 'config', 'alertas'].forEach(t =>
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => onChange(t)));
      ch.subscribe();
      return () => { c.removeChannel(ch); };
    },
    async sair() { await c.auth.signOut(); },
  };
}
