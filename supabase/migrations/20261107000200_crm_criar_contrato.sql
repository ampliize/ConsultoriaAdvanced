-- =====================================================================
-- CRM: criar contrato para um lead (o link vai pelo WhatsApp automaticamente)
-- A cobrança fica "a_gerar"; a rotina do Asaas cria em até 2 minutos e
-- envia o link ao cliente (asaas_cobranca_criada com origem 'rotina').
-- =====================================================================
create or replace function public.crm_criar_contrato(p_lead uuid, p_servico text, p_modalidade text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_conv uuid; r jsonb;
begin
  if not public.is_crm_user() then raise exception 'sem acesso'; end if;
  if coalesce((public.cfg_txt('asaas_ativo'))::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'erro', 'Ligue a cobrança pelo Asaas em Configurações para criar contratos pelo CRM.');
  end if;
  select id into v_conv from public.conversas where lead_id = p_lead;
  if v_conv is null then return jsonb_build_object('ok', false, 'erro', 'Este lead não tem conversa no WhatsApp.'); end if;
  r := public.iniciar_contratacao(v_conv, p_servico, p_modalidade, public.crm_email());
  if (r->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'erro', replace(coalesce(r->>'orientacao', 'Não foi possível criar o contrato.'),
      'Antes de gerar o link, peça o nome completo e o CPF ou CNPJ (com a autorização LGPD) e salve com atualizar_ficha_lead.',
      'Preencha o nome completo e o CPF/CNPJ do lead antes de criar o contrato.'));
  end if;
  insert into public.auditoria (acao, detalhe, por)
  values ('contrato_criado_crm', jsonb_build_object('lead_id', p_lead, 'servico', p_servico, 'modalidade', p_modalidade), public.crm_email());
  return jsonb_build_object('ok', true, 'cobranca_id', r->>'cobranca_id', 'condicao', r->>'condicao', 'link', r->>'link');
end $$;

revoke execute on function public.crm_criar_contrato(uuid, text, text) from public, anon;
grant execute on function public.crm_criar_contrato(uuid, text, text) to authenticated;
