-- Fim das mensagens duplicadas da IA.
-- 1) Lead manda outra mensagem enquanto a IA ainda responde: a resposta antiga é descartada
--    (o envio confere se chegou mensagem nova do lead depois do lote) e a execução seguinte
--    responde tudo de uma vez, recebendo também as mensagens do lote descartado.
-- 2) Lembrete "Conseguiu ver minha última mensagem?" no máximo 1 a cada 20 h por conversa
--    e sem "Oi, !" quando o lead não tem nome.

alter table public.conversas add column if not exists ultimo_followup_em timestamptz;

-- (1a) o lote inclui as mensagens do lead que outra execução acabou de pegar e ainda não
--      respondeu (processadas há menos de 3 minutos e sem resposta enviada depois delas)
create or replace function public.coletar_lote(p_conversa uuid, p_msg bigint, p_forcar boolean default false)
returns jsonb language plpgsql as $$
declare v_conv public.conversas; v_ult bigint; v_prim bigint; v_base bigint; v_txt text; v_audio boolean;
begin
  select * into v_conv from public.conversas where id = p_conversa for update;
  if not found then return jsonb_build_object('processar', false, 'motivo','sem_conversa'); end if;
  if not public.ia_ativa(v_conv) then
    return jsonb_build_object('processar', false, 'motivo','ia_inativa');
  end if;
  select max(id), min(id) into v_ult, v_prim from public.mensagens
   where conversa_id = p_conversa and direcao = 'in' and processada_em is null;
  if v_ult is null then return jsonb_build_object('processar', false, 'motivo','nada_pendente'); end if;
  if not p_forcar and v_ult <> p_msg then
    return jsonb_build_object('processar', false, 'motivo','chegou_mensagem_mais_nova');
  end if;
  select coalesce(max(id), 0) into v_base from public.mensagens
   where conversa_id = p_conversa and direcao = 'out' and coalesce(status_envio, 'enviado') <> 'falhou';
  select string_agg(public.texto_msg(m), E'\n' order by m.id), bool_or(m.tipo = 'audio')
    into v_txt, v_audio
    from public.mensagens m
   where m.conversa_id = p_conversa and m.direcao = 'in'
     and (m.processada_em is null
          or (m.autor = 'lead' and m.id > v_base and m.processada_em > now() - interval '3 minutes'));
  update public.mensagens set processada_em = now()
   where conversa_id = p_conversa and direcao = 'in' and processada_em is null;
  update public.conversas set nao_lidas = 0 where id = p_conversa;
  return jsonb_build_object('processar', true, 'texto', v_txt, 'tinha_audio', coalesce(v_audio,false),
                            'primeiro_id', v_prim, 'ultimo_id', v_ult);
end $$;

-- (1b) envio da IA com o lote (primeiro_id): se o lead mandou mensagem depois desse lote,
--      a resposta ficou velha e não é enviada (nem o resto dela)
create or replace function public.preparar_envio(p_conversa uuid, p_tipo text, p_texto text,
                                                 p_autor text default 'ia', p_lote bigint default null)
returns jsonb language plpgsql as $$
declare c public.conversas; v_id bigint; v_ult timestamptz; v_int int; v_lote_em timestamptz;
begin
  select * into c from public.conversas where id = p_conversa;
  -- a IA pode mandar a frase de transferência logo após transferir (até 3 min)
  if p_autor = 'ia' and not public.ia_ativa(c)
     and not (c.aguardando_humano and not c.assumida_manual and not public.sdr_pausado()
              and c.handoff_em > now() - interval '3 minutes'
              and (c.humano_ultima_atividade_em is null or c.humano_ultima_atividade_em < c.handoff_em)) then
    return jsonb_build_object('permitido', false, 'motivo', case when public.sdr_pausado() then 'pausa_geral' else 'humano_na_conversa' end);
  end if;
  if p_autor = 'ia' and p_lote is not null then
    select processada_em into v_lote_em from public.mensagens where id = p_lote and conversa_id = p_conversa;
    if exists (select 1 from public.mensagens m
                where m.conversa_id = p_conversa and m.direcao = 'in' and m.autor = 'lead' and m.id > p_lote
                  and (m.processada_em is null or m.processada_em is distinct from v_lote_em)) then
      return jsonb_build_object('permitido', false, 'motivo', 'lead_mandou_mensagem_nova');
    end if;
  end if;
  v_int := coalesce((public.cfg_txt('intervalo_minimo_ms'))::int, 1200);
  select max(criado_em) into v_ult from public.mensagens where conversa_id = p_conversa and direcao = 'out';
  insert into public.mensagens (conversa_id, lead_id, direcao, autor, tipo, texto, status_envio)
  values (p_conversa, c.lead_id, 'out', p_autor, p_tipo, p_texto, 'enviando')
  returning id into v_id;
  return jsonb_build_object('permitido', true, 'mensagem_id', v_id, 'telefone', c.telefone,
    'aguardar_ms', greatest(0, v_int - coalesce((extract(epoch from (now() - v_ult)) * 1000)::int, v_int)),
    'base_url', public.cfg_txt('evolution_base_url'), 'instancia', public.cfg_txt('evolution_instancia'),
    'voz_id', public.cfg_txt('elevenlabs_voice_id'), 'voz_modelo', coalesce(public.cfg_txt('elevenlabs_modelo'),'eleven_multilingual_v2'));
end $$;
-- a chamada antiga (4 argumentos) passa a cair na nova, com p_lote nulo
drop function if exists public.preparar_envio(uuid, text, text, text);

-- (2) régua de follow-up
create or replace function public.followups_devidos()
returns setof jsonb language plpgsql as $$
declare
  c record;
  v_h int[] := coalesce(array(select jsonb_array_elements_text(public.cfg('followup_horas'))::int), '{2,24,48}');
  v_tpl jsonb := coalesce(public.cfg('followup_mensagens'), '[]'::jsonb);
  v_jan jsonb := coalesce(public.cfg('followup_janela'), '{"inicio":"08:00","fim":"20:00"}'::jsonb);
  v_agora time := (now() at time zone 'America/Maceio')::time;
  v_txt text; v_nome text;
begin
  if public.sdr_pausado() then return; end if;
  -- leads que esgotaram a régua → perdido
  for c in select cv.id, cv.lead_id from public.conversas cv join public.leads l on l.id = cv.lead_id
            where cv.followup_etapa >= array_length(v_h,1)
              and cv.followup_base_em < now() - make_interval(hours => v_h[array_length(v_h,1)] + 24)
              and l.etapa in ('novo','em_atendimento','qualificado','proposta')
              and (l.ultima_msg_lead_em is null or l.ultima_msg_lead_em < cv.followup_base_em) loop
    perform public.avancar_etapa(c.lead_id, 'perdido', 'sem_resposta');
  end loop;

  if v_agora < (v_jan->>'inicio')::time or v_agora > (v_jan->>'fim')::time then return; end if;

  for c in select cv.*, l.nome, l.nome_whatsapp, l.servico, l.etapa
             from public.conversas cv join public.leads l on l.id = cv.lead_id
            where cv.followup_base_em is not null
              and cv.followup_etapa < array_length(v_h,1)
              and cv.followup_base_em <= now() - make_interval(hours => v_h[cv.followup_etapa + 1])
              and (cv.ultimo_followup_em is null or cv.ultimo_followup_em < now() - interval '20 hours')
              and l.etapa in ('em_atendimento','qualificado','proposta')
              and (l.ultima_msg_lead_em is null or l.ultima_msg_lead_em < cv.followup_base_em)
              and not exists (select 1 from public.mensagens m where m.conversa_id = cv.id and m.direcao='in' and m.processada_em is null)
            for update of cv skip locked loop
    continue when not public.ia_ativa((select x from public.conversas x where x.id = c.id));
    v_txt := coalesce(v_tpl->>c.followup_etapa,
      case c.followup_etapa when 0 then 'Oi, {nome}! Conseguiu ver minha última mensagem? Fico por aqui pra te ajudar 😊'
                            when 1 then '{nome}, passando para saber se ainda posso te ajudar com seu crédito. Quer seguir?'
                            else '{nome}, vou encerrar seu atendimento por aqui. Se quiser retomar, é só me chamar!' end);
    v_nome := nullif(trim(split_part(trim(coalesce(c.nome, c.nome_whatsapp, '')), ' ', 1)), '');
    if v_nome is not null then
      v_nome := upper(left(v_nome, 1)) || lower(substr(v_nome, 2));
      v_txt := replace(v_txt, '{nome}', v_nome);
    else
      -- sem nome: "Oi, {nome}! Conseguiu" → "Oi! Conseguiu"; "{nome}, passando" → "Passando"
      v_txt := regexp_replace(v_txt, '\s*,?\s*\{nome\}\s*', '', 'g');
      v_txt := regexp_replace(v_txt, '^[\s,!.]+', '');
      v_txt := upper(left(v_txt, 1)) || substr(v_txt, 2);
    end if;
    update public.conversas set followup_etapa = followup_etapa + 1, ultimo_followup_em = now() where id = c.id;
    return next jsonb_build_object('conversa_id', c.id, 'telefone', c.telefone, 'texto', v_txt,
                                   'etapa_followup', c.followup_etapa + 1);
  end loop;
end $$;

-- conversas que já receberam lembrete hoje não recebem outro igual
update public.conversas cv set ultimo_followup_em = x.em
  from (select m.conversa_id, max(m.criado_em) as em from public.mensagens m
         where m.autor = 'ia' and m.criado_em > now() - interval '20 hours'
           and (m.texto like '%Conseguiu ver minha última mensagem%' or m.texto like '%passando para saber se ainda posso%'
                or m.texto like '%deixar seu atendimento em pausa%')
         group by m.conversa_id) x
 where x.conversa_id = cv.id and cv.ultimo_followup_em is null;
