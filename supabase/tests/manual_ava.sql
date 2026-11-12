-- Testes do manual da Ava: a IA não volta sozinha, clientes da base ficam com a equipe, base de conhecimento.
\set ON_ERROR_STOP on
begin;
set local client_min_messages = warning;
insert into crm_usuarios (email, nome, papel) values ('equipe@teste', 'Equipe', 'advance') on conflict do nothing;

do $$
declare r jsonb; conv uuid; c conversas; v_lead uuid; t text;
  msg constant text := '{"message_id":"%s","telefone":"%s","from_me":%s,"tipo":"text","texto":"%s"}';
begin
  -- A1: equipe respondeu pelo celular → a IA não volta sozinha, nem depois de 1 hora
  r := registrar_mensagem_entrada(format(msg, 'A1-1', '5579911110001', 'false', 'Oi')::jsonb);
  assert r->>'acao' = 'processar', 'A1 lead: ' || r::text;
  conv := (r->>'conversa_id')::uuid;
  r := registrar_mensagem_entrada(format(msg, 'A1-2', '5579911110001', 'true', 'Oi, aqui é a Carla')::jsonb);
  update conversas set humano_ultima_atividade_em = now() - interval '1 hour', modo = 'humano' where id = conv;
  select * into c from conversas where id = conv;
  assert not ia_ativa(c) and ia_retorna_em(c) is null, 'A1: IA não pode voltar sozinha';
  r := registrar_mensagem_entrada(format(msg, 'A1-3', '5579911110001', 'false', 'E aí?')::jsonb);
  assert r->>'acao' = 'humano', 'A1: lead fala com a equipe: ' || r::text;
  perform retomar_conversas();
  assert (select modo from conversas where id = conv) = 'humano', 'A1: rotina não devolve';
  -- só o botão devolve
  perform set_config('request.jwt.claims', '{"email":"equipe@teste"}', true);
  perform crm_devolver_ia(conv);
  select * into c from conversas where id = conv;
  assert ia_ativa(c), 'A1: devolvida';

  -- A2: com o retorno automático ligado, volta como antes
  update config set valor = 'true' where chave = 'ia_retorno_automatico';
  update conversas set humano_ultima_atividade_em = now() - interval '20 minutes', modo = 'humano' where id = conv;
  select * into c from conversas where id = conv;
  assert ia_ativa(c), 'A2: volta depois dos minutos';
  update config set valor = 'false' where chave = 'ia_retorno_automatico';

  -- A3: telefone na lista de clientes da base → equipe, com alerta; depois de devolver, a IA atende
  update config set valor = '["(79) 91111-0002"]' where chave = 'clientes_base';
  r := registrar_mensagem_entrada(format(msg, 'A3-1', '5579911110002', 'false', 'Oi, sou cliente')::jsonb);
  assert r->>'acao' = 'humano' and r->>'motivo' = 'cliente_da_base', 'A3: ' || r::text;
  conv := (r->>'conversa_id')::uuid;
  assert (select assumida_manual and assumida_por = 'cliente da base' from conversas where id = conv), 'A3 assumida';
  assert exists (select 1 from alertas where conversa_id = conv and mensagem like 'Cliente da base%'), 'A3 alerta';
  perform crm_devolver_ia(conv);
  r := registrar_mensagem_entrada(format(msg, 'A3-2', '5579911110002', 'false', 'Pode me ajudar?')::jsonb);
  assert r->>'acao' = 'processar', 'A3: devolvida, a IA atende: ' || r::text;

  -- A4: contrato pago há 5 dias = base; pago ontem = cliente novo (a IA ainda coleta os dados do contrato)
  r := registrar_mensagem_entrada(format(msg, 'A4-1', '5579911110003', 'false', 'Oi')::jsonb);
  v_lead := (r->>'lead_id')::uuid;
  insert into contratos (lead_id, servico, modalidade, valor_total, status, aderido_em) values (v_lead, 'limpa_nome', 'avista', 597, 'ativo', now() - interval '1 day');
  r := registrar_mensagem_entrada(format(msg, 'A4-2', '5579911110003', 'false', 'Mandei o comprovante')::jsonb);
  assert r->>'acao' = 'processar', 'A4 novo: ' || r::text;
  update contratos set aderido_em = now() - interval '5 days' where lead_id = v_lead;
  r := registrar_mensagem_entrada(format(msg, 'A4-3', '5579911110003', 'false', 'Como está meu processo?')::jsonb);
  assert r->>'acao' = 'humano', 'A4 base: ' || r::text;

  -- A5: base de conhecimento com o prazo do manual
  t := buscar_kb_json('prazo quantos dias')::text;
  assert t like '%30 a 45 dias úteis%' and t not like '%7 dias úteis%', 'A5: ' || left(t, 300);
  assert buscar_kb_json('com quem estou falando')::text like '%Ava%', 'A5 nome';
  assert condicao_texto('limpa_nome', 'tap') like '%vence 2 dias depois que o seu nome estiver limpo%', 'A5 condição TAP';

  raise warning 'OK: testes do manual da Ava passaram';
end $$;
rollback;
