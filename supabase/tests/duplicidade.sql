-- Testes: mensagens duplicadas da IA (lead escreve enquanto a IA responde) e lembretes.
-- psql -d <banco> -f supabase/tests/duplicidade.sql
\set ON_ERROR_STOP 1
begin;

do $$
declare r jsonb; a bigint; b bigint; l1 jsonb; l2 jsonb; conv uuid; env jsonb; t text;
begin
  -- lead manda "Sim" (A); a execução 1 pega o lote e começa a responder
  r := public.registrar_mensagem_entrada(jsonb_build_object('message_id','DUP-A','telefone','5579900001111','from_me',false,'tipo','text','texto','Sim','push_name','Angela'));
  conv := (r->>'conversa_id')::uuid; a := (r->>'mensagem_id')::bigint;
  assert r->>'acao' = 'processar', 'D1: mensagem A deveria ser processada: ' || r::text;
  l1 := public.coletar_lote(conv, a);
  assert (l1->>'processar')::boolean and (l1->>'primeiro_id')::bigint = a, 'D1: lote 1 ' || l1::text;
  -- (no teste tudo roda numa transação só, com o mesmo now(): recua o horário do lote 1)
  update public.mensagens set processada_em = now() - interval '10 seconds' where id = a;

  -- antes de a IA enviar, chega "De onde vcs falam" (B)
  r := public.registrar_mensagem_entrada(jsonb_build_object('message_id','DUP-B','telefone','5579900001111','from_me',false,'tipo','text','texto','De onde vcs falam','push_name','Angela'));
  b := (r->>'mensagem_id')::bigint;

  -- D2: a resposta da execução 1 ficou velha e não sai
  env := public.preparar_envio(conv, 'text', 'Oi! Posso consultar seu CPF?', 'ia', a);
  assert not (env->>'permitido')::boolean and env->>'motivo' = 'lead_mandou_mensagem_nova', 'D2: ' || env::text;

  -- D3: a execução 2 pega A e B juntas e responde
  l2 := public.coletar_lote(conv, b);
  assert (l2->>'processar')::boolean, 'D3: lote 2 ' || l2::text;
  assert l2->>'texto' = E'Sim\nDe onde vcs falam', 'D3: lote 2 deveria ter A e B: ' || (l2->>'texto');
  env := public.preparar_envio(conv, 'text', 'Somos de Aracaju.', 'ia', (l2->>'primeiro_id')::bigint);
  assert (env->>'permitido')::boolean, 'D3: resposta do lote 2 deveria sair: ' || env::text;

  -- D4: mesmo que a execução 1 tente depois do lote 2, continua bloqueada
  env := public.preparar_envio(conv, 'text', 'resto da resposta velha', 'ia', a);
  assert not (env->>'permitido')::boolean, 'D4: ' || env::text;

  -- D5: envio sem lote (lembretes, links, equipe) não é afetado
  env := public.preparar_envio(conv, 'text', 'lembrete', 'ia');
  assert (env->>'permitido')::boolean, 'D5: ' || env::text;

  -- D6: depois de respondido, uma mensagem nova não traz A e B de volta
  r := public.registrar_mensagem_entrada(jsonb_build_object('message_id','DUP-C','telefone','5579900001111','from_me',false,'tipo','text','texto','Ok','push_name','Angela'));
  l1 := public.coletar_lote(conv, (r->>'mensagem_id')::bigint);
  assert l1->>'texto' = 'Ok', 'D6: ' || (l1->>'texto');

  -- D7: lembrete sem nome não sai "Oi, !" e não repete em menos de 20 h
  update public.leads set nome = null, nome_whatsapp = null, etapa = 'em_atendimento'
   where id = (select lead_id from public.conversas where id = conv);
  update public.mensagens set processada_em = now() where conversa_id = conv;
  update public.leads set ultima_msg_lead_em = now() - interval '5 hours' where id = (select lead_id from public.conversas where id = conv);
  update public.conversas set followup_etapa = 0, followup_base_em = now() - interval '3 hours', ultimo_followup_em = null,
         assumida_manual = false, aguardando_humano = false where id = conv;
  update public.config set valor = '{"inicio":"00:00","fim":"23:59"}' where chave = 'followup_janela';
  select x->>'texto' into t from public.followups_devidos() x where (x->>'conversa_id')::uuid = conv;
  assert t is not null and t not like '%{nome}%' and t not like 'Oi, !%' and t like 'Oi! %', 'D7: texto sem nome: ' || coalesce(t, '(nenhum)');
  -- lead responde, a régua recomeça, mas o lembrete não volta no mesmo dia
  update public.conversas set followup_etapa = 0, followup_base_em = now() - interval '3 hours' where id = conv;
  t := null;
  select x->>'texto' into t from public.followups_devidos() x where (x->>'conversa_id')::uuid = conv;
  assert t is null, 'D7: lembrete repetido em menos de 20 h: ' || t;

  raise notice 'OK: testes de duplicidade passaram';
end $$;

rollback;
