-- Testes: cobrança gerada pela equipe no CRM (produto e personalizada), split por contrato e avisos do 1º pagamento.
-- psql -d <banco> -f supabase/tests/cobranca_crm.sql   (roda numa transação e desfaz tudo)
\set ON_ERROR_STOP on
begin;
set local client_min_messages = warning;

update config set valor = 'true' where chave = 'asaas_ativo';
update config set valor = '[{"nome":"Davy","walletId":"w-davy","percentual":12.5},{"nome":"Caio","walletId":"w-caio","percentual":12.5}]' where chave = 'split_beneficiarios';
update config set valor = '{"inicio":"00:00","fim":"23:59"}' where chave = 'notif_janela';
insert into crm_usuarios (email, nome, papel) values ('equipe@teste', 'Equipe', 'advance') on conflict do nothing;
insert into leads (telefone, nome_whatsapp) values ('5579990000777', 'Zé');
insert into conversas (lead_id, telefone) select id, telefone from leads where telefone = '5579990000777';

do $$
declare v_lead uuid := (select id from leads where telefone = '5579990000777'); r jsonb; r2 jsonb; c cobrancas; ct contratos; n int; t text;
begin
  -- C1: sem login do CRM não gera
  begin r := crm_gerar_cobranca(v_lead, '{}'); assert false, 'C1: deveria negar';
  exception when others then assert sqlerrm = 'sem acesso', 'C1: ' || sqlerrm; end;
  perform set_config('request.jwt.claims', '{"email":"equipe@teste"}', true);

  -- C2: validações dos dados do cliente
  r := crm_gerar_cobranca(v_lead, '{"tipo":"produto","servico":"limpa_nome","modalidade":"avista"}');
  assert not (r->>'ok')::boolean and r->>'erro' like 'Preencha o nome%', 'C2a: ' || r::text;
  r := crm_gerar_cobranca(v_lead, '{"tipo":"produto","servico":"limpa_nome","modalidade":"avista","nome":"José da Silva","cpf_cnpj":"111.111.111-11"}');
  assert r->>'erro' like 'CPF ou CNPJ inválido%', 'C2b: ' || r::text;
  r := crm_gerar_cobranca(v_lead, '{"tipo":"produto","servico":"limpa_nome","modalidade":"avista","nome":"José da Silva","cpf_cnpj":"529.982.247-25","vencimento":"2020-01-01"}');
  assert r->>'erro' like 'O vencimento%', 'C2c: ' || r::text;

  -- C3: produto da tabela (Combo TAP), sem envio automático do link
  r := crm_gerar_cobranca(v_lead, jsonb_build_object('tipo','produto','servico','combo','modalidade','tap','nome','José da Silva',
        'cpf_cnpj','529.982.247-25','email','Ze@Teste.com','endereco','Rua A, 1','vencimento', to_char(hoje() + 5, 'YYYY-MM-DD'), 'enviar_link', false));
  assert (r->>'ok')::boolean, 'C3: ' || r::text;
  select * into c from cobrancas where id = (r->>'cobranca_id')::uuid;
  select * into ct from contratos where id = c.contrato_id;
  assert ct.servico = 'combo' and ct.modalidade = 'tap' and ct.valor_total = 2082 and ct.custo_produto = 197 and ct.criado_por = 'equipe@teste', 'C3 contrato: ' || row_to_json(ct)::text;
  assert c.valor = 597 and c.status = 'a_gerar' and c.vencimento = hoje() + 5 and not c.enviar_link, 'C3 cobrança: ' || row_to_json(c)::text;
  assert (select nome = 'José da Silva' and cpf_cnpj = '52998224725' and email = 'ze@teste.com' and endereco = 'Rua A, 1' and etapa = 'proposta' from leads where id = v_lead), 'C3 lead';
  -- o Asaas recebe custo + split do produto; link criado pela rotina NÃO vai sozinho (enviar_link = false)
  r2 := asaas_reservar_cobranca(c.id);
  assert (r2->'cobranca'->>'value')::numeric = 597 and jsonb_array_length(r2->'cobranca'->'split') = 2
     and (select sum((x->>'fixedValue')::numeric) from jsonb_array_elements(r2->'cobranca'->'split') x) = 100, 'C3 split (597-197)*25% = 100: ' || r2::text;
  perform asaas_cobranca_criada(c.id, '{"id":"pay_c3","invoiceUrl":"https://asaas/i/c3"}'::jsonb, 'rotina');
  assert not exists (select 1 from notificacoes where cobranca_id = c.id), 'C3: link não deveria ir sozinho';
  -- botão "Enviar na conversa"
  r2 := crm_enviar_link_cobranca(c.id);
  assert (r2->>'ok')::boolean and exists (select 1 from notificacoes where cobranca_id = c.id and texto like '%https://asaas/i/c3%'), 'C3 enviar link: ' || r2::text;

  -- C4: personalizada simples, com comissão e sem custo
  r := crm_gerar_cobranca(v_lead, '{"tipo":"personalizada","descricao":"Limpa Nome CPF + CNPJ + Rating","valor":"2000"}');
  assert (r->>'ok')::boolean, 'C4: ' || r::text;
  select * into c from cobrancas where id = (r->>'cobranca_id')::uuid;
  select * into ct from contratos where id = c.contrato_id;
  assert ct.servico = 'personalizada' and ct.valor_total = 2000 and ct.custo_produto = 0 and ct.com_split and c.tipo = 'avista' and c.enviar_link, 'C4 contrato';
  r2 := asaas_reservar_cobranca(c.id);
  assert r2->'cobranca'->>'description' like 'Advance · Limpa Nome CPF + CNPJ + Rating%', 'C4 descrição: ' || (r2->'cobranca'->>'description');
  assert (select sum((x->>'fixedValue')::numeric) from jsonb_array_elements(r2->'cobranca'->'split') x) = 500, 'C4 split 25% de 2000: ' || r2::text;
  perform asaas_cobranca_criada(c.id, '{"id":"pay_c4","invoiceUrl":"https://asaas/i/c4"}'::jsonb, 'rotina');
  select texto into t from notificacoes where cobranca_id = c.id;
  assert t like '%https://asaas/i/c4%', 'C4: link vai sozinho para o cliente: ' || coalesce(t, '(nada)');

  -- C5: personalizada com entrada + 5 parcelas só depois da entrega, sem comissão, com custo; duas abertas ao mesmo tempo
  r := crm_gerar_cobranca(v_lead, '{"tipo":"personalizada","descricao":"Pacote especial","valor":1000,"parcelas":5,"valor_parcela":300,"aguardar_entrega":true,"com_split":false,"custo":150}');
  assert (r->>'ok')::boolean, 'C5: ' || r::text;
  select * into c from cobrancas where id = (r->>'cobranca_id')::uuid;
  select * into ct from contratos where id = c.contrato_id;
  assert ct.valor_total = 2500 and not ct.com_split and ct.custo_produto = 150 and ct.parcelas_aguardam_entrega and c.tipo = 'adesao', 'C5 contrato';
  select count(*) into n from cobrancas where contrato_id = ct.id and numero > 1 and status = 'planejada' and vencimento is null;
  assert n = 5, 'C5: 5 parcelas esperando a entrega, achou ' || n;
  r2 := asaas_reservar_cobranca(c.id);
  assert jsonb_array_length(r2->'cobranca'->'split') = 0, 'C5: sem comissão: ' || r2::text;
  assert rotulo_cobranca(c) = 'entrada', 'C5 rótulo: ' || rotulo_cobranca(c);
  -- pagou a entrada e a equipe marcou a entrega: parcelas ganham data
  update cobrancas set status = 'confirmada', asaas_payment_id = 'pay_c5' where id = c.id;
  update contratos set status = 'ativo', processo_etapa = 'baixa' where id = ct.id;
  assert liberar_parcela_final_2x(ct.id) = 5, 'C5: liberar parcelas';
  assert (select min(vencimento) from cobrancas where contrato_id = ct.id and numero > 1) = hoje() + 2, 'C5: 1ª parcela em 2 dias';

  -- C6: personalizada com parcelas mensais (sem esperar entrega)
  r := crm_gerar_cobranca(v_lead, jsonb_build_object('tipo','personalizada','descricao','Serviço Reclame Aqui','valor',1500,'parcelas',1,'valor_parcela',1500,'vencimento', to_char(hoje() + 3, 'YYYY-MM-DD')));
  assert (r->>'ok')::boolean, 'C6: ' || r::text;
  assert (select vencimento from cobrancas where contrato_id = (select contrato_id from cobrancas where id = (r->>'cobranca_id')::uuid) and numero = 2) = (hoje() + 3 + interval '1 month')::date, 'C6: 2ª em 1 mês';

  -- C7: validações da personalizada
  assert (crm_gerar_cobranca(v_lead, '{"tipo":"personalizada","descricao":"x","valor":100}')->>'erro') like 'Descreva%', 'C7a';
  assert (crm_gerar_cobranca(v_lead, '{"tipo":"personalizada","descricao":"Teste","valor":2}')->>'erro') like 'O valor mínimo%', 'C7b';
  assert (crm_gerar_cobranca(v_lead, '{"tipo":"personalizada","descricao":"Teste","valor":"abc"}')->>'erro') like 'Confira os valores%', 'C7c';
  assert (crm_gerar_cobranca(v_lead, '{"tipo":"personalizada","descricao":"Teste","valor":100,"custo":500}')->>'erro') like 'O custo%', 'C7d';

  -- C8: data inválida vinda da IA não derruba mais a contratação
  assert data_segura('') is null and data_segura('amanhã') is null and data_segura('2026-13-45') is null and data_segura('2026-11-20') = date '2026-11-20', 'C8';

  -- C10: produto sem data escolhida vence em 2 dias (não em 45)
  insert into leads (telefone, nome, cpf_cnpj) values ('5579990000778', 'Ana Teste', '52998224725');
  insert into conversas (lead_id, telefone) select id, telefone from leads where telefone = '5579990000778';
  r := crm_gerar_cobranca((select id from leads where telefone = '5579990000778'), '{"tipo":"produto","servico":"rating","modalidade":"2x"}');
  assert (r->>'ok')::boolean and (select vencimento from cobrancas where id = (r->>'cobranca_id')::uuid) = hoje() + 2, 'C10: ' || r::text;
  assert (crm_gerar_cobranca((select id from leads where telefone = '5579990000778'), '{"tipo":"produto","servico":"rating","modalidade":"tap"}')->>'ok')::boolean is not true, 'C10: rating não tem TAP';

  -- C11: pagamento de cobrança personalizada confirma o lead e ativa o contrato
  select c2.* into c from cobrancas c2 join contratos k on k.id = c2.contrato_id where k.descricao = 'Serviço Reclame Aqui' and c2.numero = 1;
  perform asaas_reservar_cobranca(c.id);
  perform asaas_cobranca_criada(c.id, '{"id":"pay_c6","invoiceUrl":"https://asaas/i/c6"}'::jsonb, 'agente');
  r := asaas_registrar_evento(jsonb_build_object('id','evt_c6','event','PAYMENT_RECEIVED','payment', jsonb_build_object(
     'id','pay_c6','value',1500,'netValue',1498,'billingType','PIX','status','RECEIVED','clientPaymentDate', to_char(hoje(),'YYYY-MM-DD'),'externalReference', c.id::text)));
  assert (select status from contratos where id = c.contrato_id) = 'ativo', 'C11 contrato ativo: ' || r::text;
  assert (select pagamento_status = 'confirmado' and etapa = 'pago' and valor_venda = 3000 from leads where id = v_lead), 'C11 lead pago: ' || (select row_to_json(x)::text from (select pagamento_status, etapa, valor_venda, forma_pagamento from leads where id = v_lead) x);
  assert (select count(*) from comissoes where cobranca_id = c.id and status in ('a_liquidar','liquidada')) = 2, 'C11 comissões';

  -- C9: aviso do 1º pagamento só com a opção ligada
  select c2.* into c from cobrancas c2 join contratos k on k.id = c2.contrato_id where k.descricao = 'Limpa Nome CPF + CNPJ + Rating' and c2.numero = 1;
  update cobrancas set status = 'vencida', vencimento = hoje() - 1 where id = c.id;
  update config set valor = '[1,5]' where chave = 'notif_vencida_dias';
  delete from notificacoes;
  perform notificacoes_devidas();
  assert not exists (select 1 from notificacoes where tipo = 'vencida'), 'C9: desligado não avisa';
  update config set valor = 'true' where chave = 'notif_primeira_cobranca';
  perform notificacoes_devidas();
  select texto into t from notificacoes where tipo = 'vencida' and cobranca_id = c.id;
  assert t like '%venceu em%' and t like '%Limpa Nome CPF + CNPJ + Rating%' and t like '%https://asaas/i/c4%', 'C9: aviso do 1º pagamento: ' || coalesce(t, '(nada)');

  raise warning 'OK: testes de cobrança pelo CRM passaram';
end $$;
rollback;
