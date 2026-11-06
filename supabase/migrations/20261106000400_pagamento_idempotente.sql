-- =====================================================================
-- confirmar_pagamento idempotente: o Asaas envia PAYMENT_CONFIRMED e,
-- no cartão, PAYMENT_RECEIVED dias depois para o mesmo pagamento.
-- O segundo aviso não pode fazer a IA agradecer de novo.
-- =====================================================================
create or replace function public.confirmar_pagamento(p_lead uuid, p_valor numeric, p_forma text, p_por text default 'sistema')
returns jsonb language plpgsql as $$
declare v_conv uuid; l public.leads;
begin
  perform set_config('adv.por', coalesce(p_por,'sistema'), true);
  select * into l from public.leads where id = p_lead for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'lead_nao_encontrado'); end if;
  if l.pagamento_status = 'confirmado' then
    return jsonb_build_object('ok', true, 'lead_id', p_lead, 'ja_confirmado', true);
  end if;
  update public.leads set pagamento_status = 'confirmado', pago_em = coalesce(pago_em, now()),
         valor_venda = coalesce(p_valor, valor_previsto, valor_venda),
         forma_pagamento = coalesce(p_forma, forma_pagamento)
   where id = p_lead returning * into l;
  perform public.avancar_etapa(p_lead, 'pago');
  select id into v_conv from public.conversas where lead_id = p_lead;
  insert into public.mensagens (conversa_id, lead_id, direcao, autor, tipo, texto)
  values (v_conv, p_lead, 'in', 'sistema', 'text',
          '[SISTEMA] Pagamento de R$ ' || coalesce(l.valor_venda::text, '?') || ' confirmado. Agradeça e conduza o próximo passo: '
          || case when l.documento_recebido then 'agendar a reunião com o especialista.'
                  else 'pedir o documento de identificação completo (RG ou CNH, frente e verso) e depois agendar a reunião.' end);
  return jsonb_build_object('ok', true, 'lead_id', p_lead);
end $$;
