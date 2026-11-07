-- =====================================================================
-- Testes do financeiro (contratos, split, webhook do Asaas, quitação, notificações)
-- Rodar num banco de teste já com as migrations: psql -f supabase/tests/financeiro.sql
-- Cada bloco falha com exceção se a regra não for respeitada.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- prepara: lead qualificado com CPF, Asaas ligado e beneficiários do split
update config set valor = 'true' where chave = 'asaas_ativo';
update config set valor = '[{"nome":"Davy","walletId":"w-davy","percentual":12.5},{"nome":"Caio","walletId":"w-caio","percentual":12.5}]'
 where chave = 'split_beneficiarios';
update config set valor = '{"inicio":"00:00","fim":"23:59"}' where chave = 'notif_janela';
insert into leads (telefone, nome, cpf_cnpj, consentimento_lgpd_em) values ('5579990000101', 'Maria Teste', '52998224725', now());
insert into conversas (lead_id, telefone) select id, telefone from leads where telefone = '5579990000101';

create temp table t_ctx as
select (select id from conversas where telefone = '5579990000101') as conv,
       (select id from leads where telefone = '5579990000101') as lead;

\echo 'F1. split: 25% do bruto dividido 12,5% + 12,5%, soma exata em centavos'
do $$
declare s jsonb;
begin
  s := split_calcular('limpa_nome', 297);
  assert (s->0->>'fixedValue')::numeric + (s->1->>'fixedValue')::numeric = 74.25, 'split 297 deve somar 74,25: ' || s;
  s := split_calcular('limpa_nome', 150);
  assert (s->0->>'fixedValue')::numeric = 18.75 and (s->1->>'fixedValue')::numeric = 18.75, 'split 150: ' || s;
  s := split_calcular('limpa_nome', 597);
  assert (s->0->>'fixedValue')::numeric + (s->1->>'fixedValue')::numeric = 149.25, 'split 597: ' || s;
  s := split_calcular('limpa_nome', 400);
  assert (s->0->>'fixedValue')::numeric = 50 and (s->1->>'fixedValue')::numeric = 50, 'split 400: ' || s;
  assert split_calcular('diagnostico', 67) = '[]'::jsonb, 'diagnóstico não tem split';
end $$;

\echo 'F2. modalidades e totais'
do $$
begin
  assert (select sum(x) from unnest(plano_parcelas('limpa_nome','tap')) x) = 1047, 'TAP = 1047';
  assert (select sum(x) from unnest(plano_parcelas('limpa_nome','2x')) x) = 800, '2x = 800';
  assert (select sum(x) from unnest(plano_parcelas('limpa_nome','avista')) x) = 597, 'à vista = 597';
  assert normalizar_modalidade('limpa_nome', 'entrada + 5x') = 'tap';
  assert normalizar_modalidade('limpa_nome', 'em 2 vezes') = '2x';
  assert normalizar_modalidade('limpa_nome', 'à vista') = 'avista';
  assert normalizar_modalidade('limpa_nome', 'qualquer') is null;
end $$;

\echo 'F3. sem CPF não gera link; com CPF cria contrato TAP com 6 cobranças (1ª a gerar)'
do $$
declare r jsonb; v_lead uuid := (select lead from t_ctx); v_conv uuid := (select conv from t_ctx);
begin
  update leads set cpf_cnpj = null where id = v_lead;
  r := iniciar_contratacao(v_conv, 'limpa_nome', 'tap');
  assert (r->>'ok')::boolean = false, 'sem CPF deveria recusar';
  update leads set cpf_cnpj = '52998224725' where id = v_lead;
  r := iniciar_contratacao(v_conv, 'limpa_nome', 'tap');
  assert r->>'acao' = 'gerar_cobranca', 'deveria pedir para gerar cobrança: ' || r;
  assert (select count(*) from cobrancas where lead_id = v_lead) = 6, '6 cobranças';
  assert (select status from cobrancas where lead_id = v_lead and numero = 1) = 'a_gerar';
  assert (select count(*) from cobrancas where lead_id = v_lead and status = 'planejada' and vencimento is null) = 5;
  assert (select valor_previsto from leads where id = v_lead) = 1047;
  assert (select etapa from leads where id = v_lead) = 'proposta';
end $$;

\echo 'F4. trocar de modalidade antes de pagar cancela o contrato anterior'
do $$
declare r jsonb; v_lead uuid := (select lead from t_ctx); v_conv uuid := (select conv from t_ctx);
begin
  r := iniciar_contratacao(v_conv, 'limpa_nome', '2x');
  assert (select count(*) from contratos where lead_id = v_lead and status = 'cancelado') = 1, 'TAP cancelado';
  assert (select count(*) from contratos where lead_id = v_lead and status = 'aguardando_pagamento' and modalidade = '2x') = 1;
  r := iniciar_contratacao(v_conv, 'limpa_nome', 'tap');   -- volta ao TAP
  assert (select count(*) from contratos where lead_id = v_lead and status = 'aguardando_pagamento') = 1, 'só 1 contrato aberto';
end $$;

\echo 'F5. reserva da cobrança devolve dados do Asaas com split e não deixa reservar 2x'
do $$
declare r jsonb; r2 jsonb; v_cob uuid;
begin
  select c.id into v_cob from cobrancas c join contratos ct on ct.id = c.contrato_id
   where ct.status = 'aguardando_pagamento' and c.numero = 1 and c.lead_id = (select lead from t_ctx);
  r := asaas_reservar_cobranca(v_cob);
  assert (r->>'ok')::boolean and r#>>'{cobranca,billingType}' = 'BOLETO', 'reserva: ' || r;
  assert (r#>>'{cobranca,value}')::numeric = 297;
  assert jsonb_array_length(r#>'{cobranca,split}') = 2;
  assert r#>>'{cliente,mobilePhone}' = '79990000101', 'telefone sem 55: ' || (r#>>'{cliente,mobilePhone}');
  assert (r#>>'{cliente,notificationDisabled}')::boolean = true;
  r2 := asaas_reservar_cobranca(v_cob);
  assert (r2->>'ok')::boolean = false, 'segunda reserva deve falhar';
  -- Asaas criou a cobrança
  r := asaas_cobranca_criada(v_cob, jsonb_build_object('id','pay_1','invoiceUrl','https://sandbox.asaas.com/i/1',
        'dueDate', to_char(hoje()+2,'YYYY-MM-DD'),
        'split', '[{"id":"sp-davy","walletId":"w-davy","fixedValue":37.13,"status":"PENDING"},{"id":"sp-caio","walletId":"w-caio","fixedValue":37.12,"status":"PENDING"}]'::jsonb));
  assert r->>'link' = 'https://sandbox.asaas.com/i/1';
  assert (select status from cobrancas where id = v_cob) = 'pendente';
  assert (select count(*) from comissoes where cobranca_id = v_cob and status = 'prevista') = 2;
  assert (select sum(valor) from comissoes where cobranca_id = v_cob) = 74.25;
  -- pedir o link de novo devolve o mesmo
  r := iniciar_contratacao((select conv from t_ctx), 'limpa_nome', 'tap');
  assert r->>'link' = 'https://sandbox.asaas.com/i/1', 'mesmo link: ' || r;
end $$;

\echo 'F6. webhook: evento repetido não processa duas vezes; pagamento ativa o contrato e agenda as parcelas'
do $$
declare r jsonb; v_lead uuid := (select lead from t_ctx); n_msgs int;
  body jsonb := jsonb_build_object('id','evt_1','event','PAYMENT_CONFIRMED','payment', jsonb_build_object(
     'id','pay_1','value',297,'netValue',295.01,'billingType','BOLETO','status','CONFIRMED',
     'clientPaymentDate', to_char(hoje(),'YYYY-MM-DD'), 'externalReference', ''));
begin
  r := asaas_registrar_evento(body);
  assert (r->>'duplicado')::boolean = false;
  r := asaas_registrar_evento(body);
  assert (r->>'duplicado')::boolean = true, 'repetido';
  assert (select count(*) from asaas_eventos where id = 'evt_1') = 1;
  assert (select status from contratos where lead_id = v_lead and status <> 'cancelado') = 'ativo';
  assert (select status from cobrancas where asaas_payment_id = 'pay_1') = 'confirmada';
  assert (select count(*) from comissoes c join cobrancas b on b.id = c.cobranca_id where b.asaas_payment_id = 'pay_1' and c.status = 'a_liquidar') = 2;
  assert (select count(*) from cobrancas c join contratos ct on ct.id = c.contrato_id
           where ct.status = 'ativo' and c.status = 'planejada' and c.vencimento is not null) = 5, 'parcelas agendadas';
  assert (select min(vencimento) from cobrancas c join contratos ct on ct.id = c.contrato_id
           where ct.status = 'ativo' and c.status = 'planejada') = (hoje() + interval '1 month')::date, '1ª parcela em 1 mês';
  assert (select pagamento_status from leads where id = v_lead) = 'confirmado';
  assert (select etapa from leads where id = v_lead) = 'pago';
  select count(*) into n_msgs from mensagens where lead_id = v_lead and texto like '[SISTEMA] Pagamento%';
  assert n_msgs = 1, 'IA avisada 1 vez: ' || n_msgs;
  -- depois chega o RECEIVED: só muda o status
  r := asaas_registrar_evento(jsonb_set(jsonb_set(body, '{id}', '"evt_2"'), '{event}', '"PAYMENT_RECEIVED"'));
  assert (select status from cobrancas where asaas_payment_id = 'pay_1') = 'recebida';
  assert (select count(*) from mensagens where lead_id = v_lead and texto like '[SISTEMA] Pagamento%') = 1, 'sem 2º aviso';
  -- split liquidado
  r := asaas_registrar_evento('{"id":"evt_3","event":"PAYMENT_SPLIT_DONE","payment":{"id":"pay_1"},"additionalInfo":{"splitId":"sp-davy"}}');
  assert (select status from comissoes where asaas_split_id = 'sp-davy') = 'liquidada';
  assert (select status from comissoes where asaas_split_id = 'sp-caio') = 'a_liquidar';
end $$;

\echo 'F7. parcela perto do vencimento vira cobrança a gerar; vencida deixa o contrato inadimplente'
do $$
declare r jsonb; v_cob uuid; v_ct uuid;
begin
  select contrato_id into v_ct from cobrancas where asaas_payment_id = 'pay_1';
  select id into v_cob from cobrancas where contrato_id = v_ct and numero = 2;
  update cobrancas set vencimento = hoje() + 3 where id = v_cob;
  update cobrancas set criado_em = now() - interval '5 minutes' where id = v_cob;
  r := asaas_sincronizacao();
  assert (select status from cobrancas where id = v_cob) = 'a_gerar';
  assert r->'gerar' ? v_cob::text, 'sincronização lista a parcela: ' || r;
  perform asaas_reservar_cobranca(v_cob);
  perform asaas_cobranca_criada(v_cob, jsonb_build_object('id','pay_2','invoiceUrl','https://sandbox.asaas.com/i/2',
            'dueDate', to_char(hoje()+3,'YYYY-MM-DD')), 'rotina');
  -- parcela (não é a 1ª) criada pela rotina não manda link na hora: o lembrete cuida disso
  assert (select count(*) from notificacoes where cobranca_id = v_cob) = 0;
  -- lembrete D-3
  perform notificacoes_devidas();
  assert (select count(*) from notificacoes where cobranca_id = v_cob and tipo = 'lembrete') = 1, 'lembrete criado';
  assert (select texto from notificacoes where cobranca_id = v_cob and tipo = 'lembrete') like '%parcela 1 de 5%R$ 150,00%https://sandbox.asaas.com/i/2%',
         'texto: ' || (select texto from notificacoes where cobranca_id = v_cob and tipo = 'lembrete');
  assert (select status from notificacoes where cobranca_id = v_cob and tipo = 'lembrete') = 'enviada', 'devolvida para envio';
  perform notificacoes_devidas();
  assert (select count(*) from notificacoes where cobranca_id = v_cob) = 1, 'não repete';
  -- vence
  perform asaas_registrar_evento(jsonb_build_object('id','evt_4','event','PAYMENT_OVERDUE','payment', jsonb_build_object('id','pay_2')));
  assert (select status from cobrancas where id = v_cob) = 'vencida';
  assert (select status from contratos where id = v_ct) = 'inadimplente';
  update cobrancas set vencimento = hoje() - 1 where id = v_cob;
  perform notificacoes_devidas();
  assert (select count(*) from notificacoes where cobranca_id = v_cob and tipo = 'vencida') = 1, 'aviso de vencida';
  -- paga atrasado: volta a ativo
  perform asaas_registrar_evento(jsonb_build_object('id','evt_5','event','PAYMENT_RECEIVED','payment',
            jsonb_build_object('id','pay_2','value',150,'netValue',148.01,'billingType','PIX','paymentDate', to_char(hoje(),'YYYY-MM-DD'))));
  assert (select status from contratos where id = v_ct) = 'ativo', 'volta a ativo';
end $$;

\echo 'F8. quitação antecipada: saldo, desconto só com autorização, cancela as abertas e cria 1 cobrança'
do $$
declare r jsonb; v_ct uuid; v_q uuid;
begin
  select contrato_id into v_ct from cobrancas where asaas_payment_id = 'pay_1';
  -- simula usuário do CRM (papel closer: sem desconto)
  insert into crm_usuarios (email, nome, papel) values ('closer@teste', 'Closer', 'closer') on conflict do nothing;
  perform set_config('request.jwt.claims', '{"email":"closer@teste"}', true);
  assert (contrato_resumo(v_ct)->>'saldo_devedor')::numeric = 600, 'saldo 4 x 150 = 600: ' || contrato_resumo(v_ct);
  r := crm_quitar_contrato(v_ct, 50, 'cliente pediu');
  assert (r->>'ok')::boolean = false, 'closer não dá desconto';
  perform set_config('request.jwt.claims', '{"email":"ampliize@gmail.com"}', true);
  r := crm_quitar_contrato(v_ct, 50, null);
  assert (r->>'ok')::boolean = false, 'desconto exige motivo';
  r := crm_quitar_contrato(v_ct, 50, 'autorizado pelo Caio');
  assert (r->>'ok')::boolean and (r->>'valor_final')::numeric = 550, 'quitação: ' || r;
  v_q := (r->>'cobranca_id')::uuid;
  assert (select count(*) from cobrancas where contrato_id = v_ct and status = 'cancelada' and motivo_cancelamento = 'quitacao') = 4,
         'parcelas planejadas canceladas';
  r := crm_quitar_contrato(v_ct, 0, null);
  assert (r->>'ok')::boolean = false, 'não cria 2 quitações';
  assert (select count(*) from auditoria where acao = 'quitacao_solicitada') = 1;
  -- Asaas: cobra a quitação com split de 25% sobre o valor recebido
  perform asaas_reservar_cobranca(v_q);
  assert (select sum((s->>'fixedValue')::numeric) from cobrancas c, jsonb_array_elements(c.split) s where c.id = v_q) = 137.50,
         'split da quitação = 25% de 550';
  perform asaas_cobranca_criada(v_q, '{"id":"pay_q","invoiceUrl":"https://sandbox.asaas.com/i/q"}', 'rotina');
  assert (select count(*) from notificacoes where cobranca_id = v_q and tipo = 'quitacao') = 1, 'link da quitação enviado';
  perform asaas_registrar_evento(jsonb_build_object('id','evt_6','event','PAYMENT_RECEIVED','payment',
            jsonb_build_object('id','pay_q','value',550,'netValue',548.01,'billingType','PIX')));
  assert (select status from contratos where id = v_ct) = 'quitado', 'contrato quitado';
  assert (select coalesce(sum(valor),0) from comissoes where contrato_id = v_ct and status in ('a_liquidar','liquidada')) = 74.25 + 37.50 + 137.50,
         'comissão total = 25% de tudo que entrou';
end $$;

\echo 'F9. estorno: cobrança e comissões estornadas, alerta para a equipe'
do $$
declare v_ct uuid;
begin
  select contrato_id into v_ct from cobrancas where asaas_payment_id = 'pay_q';
  perform asaas_registrar_evento('{"id":"evt_7","event":"PAYMENT_REFUNDED","payment":{"id":"pay_q","value":550}}');
  assert (select status from cobrancas where asaas_payment_id = 'pay_q') = 'estornada';
  assert (select count(*) from comissoes c join cobrancas b on b.id = c.cobranca_id where b.asaas_payment_id = 'pay_q' and c.status = 'estornada') = 2;
  assert exists (select 1 from alertas where mensagem like 'Cobrança estornada%');
end $$;

\echo 'F10. evento de cobrança fora do sistema é ignorado; erro não derruba o webhook'
do $$
declare r jsonb;
begin
  r := asaas_registrar_evento('{"id":"evt_8","event":"PAYMENT_RECEIVED","payment":{"id":"pay_outro"}}');
  assert (select status from asaas_eventos where id = 'evt_8') = 'ignorado';
end $$;

\echo 'F11. andamento do processo gera mensagem para o cliente'
do $$
declare r jsonb; v_ct uuid;
begin
  select contrato_id into v_ct from cobrancas where asaas_payment_id = 'pay_1';
  perform set_config('request.jwt.claims', '{"email":"ampliize@gmail.com"}', true);
  r := crm_andamento_processo(v_ct, 'protocolado', 'Número do processo: 0001234-56.2026.8.25.0001.', true);
  assert (r->>'ok')::boolean, 'andamento: ' || r;
  assert r->>'texto' like 'Maria, sua ação foi protocolada%0001234-56%', 'texto: ' || (r->>'texto');
  r := crm_andamento_processo(v_ct, 'em_andamento', null, true);
  assert r->>'texto' not like '%{detalhe}%' and r->>'texto' not like '%  %', 'sem detalhe: ' || (r->>'texto');
  assert (select processo_etapa from contratos where id = v_ct) = 'em_andamento';
end $$;

\echo 'F12. sem walletId o Limpa Nome não gera cobrança (avisa a equipe); diagnóstico gera sem split'
do $$
declare r jsonb; v_conv uuid;
begin
  update config set valor = '[{"nome":"Davy","walletId":"","percentual":12.5},{"nome":"Caio","walletId":"w-caio","percentual":12.5}]'
   where chave = 'split_beneficiarios';
  insert into leads (telefone, nome, cpf_cnpj) values ('5579990000202', 'João Teste', '52998224725');
  insert into conversas (lead_id, telefone) select id, telefone from leads where telefone = '5579990000202' returning id into v_conv;
  r := iniciar_contratacao(v_conv, 'limpa_nome', 'avista');
  assert (r->>'ok')::boolean = false, 'sem walletId não gera';
  r := iniciar_contratacao(v_conv, 'diagnostico', null);
  assert r->>'acao' = 'gerar_cobranca', 'diagnóstico gera: ' || r;
  r := asaas_reservar_cobranca((r->>'cobranca_id')::uuid);
  assert jsonb_array_length(r#>'{cobranca,split}') = 0 and (r#>>'{cobranca,value}')::numeric = 67;
end $$;

\echo 'F13. sem Asaas ligado usa os links fixos (comportamento anterior)'
do $$
declare r jsonb; v_conv uuid;
begin
  update config set valor = 'false' where chave = 'asaas_ativo';
  update config set valor = '"https://pay.exemplo/2x"' where chave = 'link_pagamento_limpa_nome_2x';
  select id into v_conv from conversas where telefone = '5579990000202';
  r := iniciar_contratacao(v_conv, 'limpa_nome', '2x');
  assert r->>'link' = 'https://pay.exemplo/2x' and (r->>'valor')::numeric = 800, 'link fixo: ' || r;
end $$;

\echo 'F14. ficha da IA traz o contrato do cliente'
do $$
declare p jsonb;
begin
  p := perfil_lead((select conv from t_ctx));
  assert p->'contrato'->>'modalidade' = 'tap', 'ficha: ' || p;
end $$;

\echo 'OK: todos os testes do financeiro passaram'
