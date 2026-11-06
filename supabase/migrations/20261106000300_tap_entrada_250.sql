-- =====================================================================
-- Condição TAP do Limpa Nome: entrada de R$ 250,00 + 5x de R$ 150,00
-- (antes: entrada de R$ 350,00). Total TAP: R$ 1.000,00.
-- =====================================================================

create or replace function public.link_pagamento(p_conversa uuid, p_servico text, p_forma text)
returns jsonb language plpgsql as $$
declare v_lead uuid; v_chave text; v_link text; v_valor numeric; v_forma text;
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  v_forma := case when p_servico = 'limpa_nome' and p_forma = 'tap' then 'tap' else 'avista' end;
  v_chave := case when p_servico = 'diagnostico' then 'link_pagamento_diagnostico'
                  when v_forma = 'tap' then 'link_pagamento_limpa_nome_tap'
                  else 'link_pagamento_limpa_nome_avista' end;
  v_link  := nullif(public.cfg_txt(v_chave), '');
  v_valor := case when p_servico = 'diagnostico' then 67 when v_forma = 'tap' then 1000 else 797 end;
  if p_servico not in ('diagnostico','limpa_nome') then
    return jsonb_build_object('ok', false, 'orientacao', 'Defina o serviço: diagnostico ou limpa_nome.');
  end if;
  update public.leads set servico = p_servico, forma_pagamento = v_forma, valor_previsto = v_valor,
         pagamento_status = case when pagamento_status in ('nenhum') then 'link_enviado' else pagamento_status end
   where id = v_lead;
  perform public.avancar_etapa(v_lead, 'proposta');
  if v_link is null then
    perform public.criar_alerta('handoff', p_conversa,
      'Lead pronto para pagar (' || p_servico || ', ' || v_forma || ') mas o link de pagamento não está configurado no CRM.');
    return jsonb_build_object('ok', false, 'orientacao',
      'O link ainda não está disponível. Diga que um consultor vai enviar o link em instantes e NÃO invente link.');
  end if;
  return jsonb_build_object('ok', true, 'link', v_link, 'valor', v_valor, 'forma', v_forma,
    'condicao', case when p_servico = 'diagnostico' then 'R$ 67,00 à vista (PIX ou cartão)'
                     when v_forma = 'tap' then 'Entrada de R$ 250,00 + 5x de R$ 150,00'
                     else 'R$ 797,00 à vista (PIX ou cartão)' end);
end $$;

-- base de conhecimento e descrição da configuração
update public.kb
   set resposta = replace(replace(resposta, 'R$ 350,00', 'R$ 250,00'), 'R$ 350', 'R$ 250')
 where resposta like '%R$ 350%';

update public.config
   set descricao = replace(descricao, 'R$ 350', 'R$ 250')
 where chave = 'link_pagamento_limpa_nome_tap';

-- propostas TAP ainda abertas passam a prever o novo total
update public.leads
   set valor_previsto = 1000
 where forma_pagamento = 'tap' and valor_previsto = 1100 and pagamento_status <> 'confirmado';
