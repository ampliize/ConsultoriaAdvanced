-- Diagnóstico (SOMENTE LEITURA): pagamentos do Asaas que o CRM ignorou (cobranças criadas fora do sistema).
select jsonb_build_object(
 'recebidos_fora', (select jsonb_agg(x) from (select to_char(recebido_em at time zone 'America/Maceio','DD/MM') dia, (payload->'payment'->>'value')::numeric valor, payload->'payment'->>'billingType' forma, left(coalesce(payload->'payment'->>'description',''), 60) descricao, (payload->'payment'->'split') is not null and jsonb_array_length(coalesce(payload->'payment'->'split','[]'::jsonb)) > 0 as tem_split, coalesce(resultado->>'motivo','') motivo, exists (select 1 from leads l where l.asaas_customer_id = payload->'payment'->>'customer') cliente_no_crm from asaas_eventos where evento = 'PAYMENT_RECEIVED' order by recebido_em) x),
 'total_recebido_fora', (select sum((payload->'payment'->>'value')::numeric) from asaas_eventos where evento = 'PAYMENT_RECEIVED' and status = 'ignorado'),
 'falhas_envio', (select jsonb_agg(x) from (select to_char(criado_em at time zone 'America/Maceio','DD/MM HH24:MI') q, left(texto, 50) t from mensagens where status_envio = 'falhou') x),
 'cobrancas_abertas', (select jsonb_agg(x) from (select c.status, c.tipo, c.valor, c.vencimento, ct.status ct_status, ct.modalidade, cv.assumida_manual from cobrancas c join contratos ct on ct.id = c.contrato_id join conversas cv on cv.lead_id = c.lead_id where c.status in ('pendente','vencida')) x),
 'followup', (select jsonb_agg(jsonb_build_object('chave', chave, 'valor', valor, 'por', atualizado_por, 'em', to_char(atualizado_em at time zone 'America/Maceio','DD/MM HH24:MI'))) from config where chave in ('followup_horas','followup_mensagens','followup_janela')),
 'notif_textos', (select valor from config where chave = 'notif_textos'),
 'processo_etapas', (select jsonb_agg(e->>'id') from config, jsonb_array_elements(valor) e where chave = 'processo_etapas'),
 'followups_enviados', (select count(*) from mensagens where autor = 'ia' and (texto like '%Conseguiu ver minha última mensagem%' or texto like '%passando para saber se ainda posso%' or texto like '%atendimento em pausa%'))
) as d;
