-- Roteiro de testes das regras do SDR (rodar num banco de teste)
\set ON_ERROR_STOP 1
\pset tuples_only on
\echo '1. lead manda mensagem'
select public.registrar_mensagem_entrada('{"message_id":"W1","telefone":"5579999990001","jid":"5579999990001@s.whatsapp.net","from_me":false,"tipo":"text","texto":"Oi, quero limpar meu nome","push_name":"Maria Souza","anuncio":{"titulo":"Limpe seu nome"}}') ->> 'acao';
select public.registrar_mensagem_entrada('{"message_id":"W2","telefone":"5579999990001","from_me":false,"tipo":"text","texto":"to com urgencia"}') ->> 'acao';
select public.registrar_mensagem_entrada('{"message_id":"W2","telefone":"5579999990001","from_me":false,"tipo":"text","texto":"dup"}') ->> 'motivo' as dedupe;
select origem, etapa from public.leads;
\echo '2. só a última execução responde o lote'
select public.coletar_lote((select id from conversas), (select min(id) from mensagens)) ->> 'motivo';
select public.coletar_lote((select id from conversas), (select max(id) from mensagens)) ->> 'texto';
\echo '3. IA envia e o eco do webhook NÃO é tratado como humano'
select public.preparar_envio((select id from conversas), 'text', 'Oi Maria! Aqui é da Advance Consultoria.') ->> 'permitido';
select public.registrar_mensagem_entrada('{"message_id":"E1","telefone":"5579999990001","from_me":true,"tipo":"text","texto":"Oi Maria! Aqui é da Advance Consultoria."}') ->> 'motivo';
select public.confirmar_envio((select max(id) from mensagens where autor='ia'), 'E1', true);
select modo, humano_ultima_atividade_em is null as sem_humano, followup_base_em is not null as followup_armado from conversas;
\echo '4. humano responde pelo número → IA para'
select public.registrar_mensagem_entrada('{"message_id":"H1","telefone":"5579999990001","from_me":true,"tipo":"text","texto":"Oi Maria, aqui é a Claudianny"}') ->> 'motivo';
select public.registrar_mensagem_entrada('{"message_id":"W3","telefone":"5579999990001","from_me":false,"tipo":"text","texto":"oi Claudianny"}') ->> 'acao' as acao_com_humano;
select public.preparar_envio((select id from conversas), 'text', 'teste') ->> 'motivo' as envio_bloqueado;
select count(*) as retomadas_antes_15min from public.retomar_conversas();
\echo '5. 15 min sem humano → IA retoma e responde o pendente'
update conversas set humano_ultima_atividade_em = now() - interval '16 minutes';
update mensagens set criado_em = now() - interval '2 minutes' where wa_message_id = 'W3';
select r ->> 'texto', r ->> 'origem' from public.retomar_conversas() r;
select modo from conversas;
\echo '6. pausa geral (emergência)'
update config set valor = '{"pausado":true}' where chave = 'sdr_pausado_global';
select public.registrar_mensagem_entrada('{"message_id":"W4","telefone":"5579999990001","from_me":false,"tipo":"text","texto":"alô"}') ->> 'acao';
update config set valor = '{"pausado":false}' where chave = 'sdr_pausado_global';
select public.coletar_lote((select id from conversas), (select max(id) from mensagens)) ->> 'processar';
\echo '7. qualificação (CPF inválido e válido)'
select public.atualizar_lead((select id from conversas), '{"nome":"Maria Souza Lima","cpf_cnpj":"111.111.111-11"}');
select public.atualizar_lead((select id from conversas), '{"cpf_cnpj":"529.982.247-25","urgencia":"alta","servico":"diagnostico","objetivo":"entender_negativa","consentimento_lgpd":true}');
\echo '8. link de pagamento sem configurar → alerta; com link → ok'
select public.link_pagamento((select id from conversas), 'diagnostico', 'avista') ->> 'ok';
update config set valor = '"https://pay.exemplo/diag"' where chave = 'link_pagamento_diagnostico';
select public.link_pagamento((select id from conversas), 'diagnostico', 'avista') ->> 'link';
\echo '9. agenda: exige pagamento, depois agenda'
select jsonb_array_length(public.horarios_livres(null, 6) -> 'horarios') as qtd_horarios;
select public.reservar_reuniao((select id from conversas), ((public.horarios_livres(null,1)->'horarios'->0->>'inicio'))::timestamptz) ->> 'orientacao';
select public.informar_pagamento((select id from conversas), 'comprovante PIX') ->> 'ok';
select public.reservar_reuniao((select id from conversas), ((public.horarios_livres(null,1)->'horarios'->0->>'inicio'))::timestamptz) ->> 'ok' as reservou;
select public.confirmar_reuniao((select id from reunioes limit 1), 'gcal123', 'https://meet.google.com/abc-defg-hij') ->> 'quando';
select etapa from leads;
select count(*) as horario_some_da_lista from jsonb_array_elements(public.horarios_livres(null,6)->'horarios') h
 where (h->>'inicio')::timestamptz = (select inicio from reunioes limit 1);
\echo '10. pagamento confirmado gera mensagem de sistema para IA'
select public.confirmar_pagamento((select id from leads), 67, 'avista') ->> 'ok';
select etapa, pagamento_status, valor_venda from leads;
\echo '11. follow-up 2h / 24h / 48h e perda por falta de resposta'
insert into leads (telefone, nome) values ('5579999990002', 'João Pedro');
insert into conversas (lead_id, telefone) select id, telefone from leads where telefone = '5579999990002';
update config set valor = '{"inicio":"00:00","fim":"23:59"}' where chave = 'followup_janela';
update leads set etapa = 'em_atendimento', ultima_msg_lead_em = now() - interval '90 hours' where telefone = '5579999990002';
update conversas set followup_base_em = now() - interval '3 hours' where telefone = '5579999990002';
select r ->> 'texto' from public.followups_devidos() r;
select count(*) as nao_repete from public.followups_devidos();
update conversas set followup_etapa = 3, followup_base_em = now() - interval '80 hours' where telefone = '5579999990002';
select count(*) from public.followups_devidos();
select etapa, motivo_perda from leads where telefone = '5579999990002';
\echo '12. base de conhecimento'
select string_agg(b ->> 'pergunta', ' | ') from jsonb_array_elements(public.buscar_kb_json('quanto custa limpar o nome')) b;
select string_agg(b ->> 'pergunta', ' | ') from jsonb_array_elements(public.buscar_kb_json('tenho garantia?')) b;
\echo '13. alertas para a equipe'
update config set valor = '["(79) 99999-0000"]' where chave = 'whatsapp_equipe';
select count(*) as alertas from public.alertas_para_notificar();
\echo '14. funil registrado'
select string_agg(coalesce(etapa_de,'∅') || '→' || etapa_para, ', ' order by id) from eventos_funil where lead_id = (select id from leads where telefone='5579999990001');
\echo '15. formato da resposta (áudio x texto)'
update config set valor = '"voz123"' where chave = 'elevenlabs_voice_id';
select public.decidir_formato(true, 'Perfeito, Maria! Vamos seguir com sua análise.'), public.decidir_formato(true, 'Segue o link https://x.y'), public.decidir_formato(false, 'Oi');
\echo '16. RLS e botões do CRM'
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"intruso@x.com"}', true);
select count(*) as intruso_ve_leads from leads;
select set_config('request.jwt.claims', '{"email":"ampliize@gmail.com"}', true);
select count(*) as ampliize_ve_leads from leads;
select public.crm_pausa_geral(true, 'teste de bug') ->> 'pausado';
select public.sdr_pausado();
select public.crm_pausa_geral(false) ->> 'pausado';
select public.crm_assumir((select id from conversas limit 1)) ->> 'ok';
select ia_ativa, assumida_por from vw_conversas where id = (select id from conversas order by criado_em limit 1);
select public.crm_devolver_ia((select id from conversas order by criado_em limit 1)) ->> 'ok';
select ia_ativa from vw_conversas order by criado_em limit 1;
select count(*) as auditoria from auditoria;
commit;
\echo '17. frase de transferência ainda sai; depois a IA fica muda'
select public.iniciar_handoff((select id from conversas order by criado_em limit 1), 'pedido_lead', 'quer falar com pessoa') ->> 'ok';
select public.preparar_envio((select id from conversas order by criado_em limit 1), 'text', 'Um especialista vai continuar por aqui.') ->> 'permitido' as frase_handoff;
update conversas set handoff_em = now() - interval '10 minutes' where id = (select id from conversas order by criado_em limit 1);
select public.preparar_envio((select id from conversas order by criado_em limit 1), 'text', 'x') ->> 'permitido' as depois_bloqueado;
