-- =====================================================================
-- ADVANCE CONSULTORIA · SDR IA (Ampliize)
-- Schema principal: leads, conversas, mensagens, funil, reuniões,
-- regras de intervenção humana, pausa geral e configuração.
-- Fuso de referência: America/Maceio (Aracaju/SE, UTC-3)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- CONFIGURAÇÃO (chave/valor) — editável pelo CRM
-- ---------------------------------------------------------------------
create table if not exists public.config (
  chave          text primary key,
  valor          jsonb not null,
  descricao      text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

create or replace function public.cfg(p_chave text)
returns jsonb language sql stable as $$
  select valor from public.config where chave = p_chave
$$;

create or replace function public.cfg_txt(p_chave text)
returns text language sql stable as $$
  select valor #>> '{}' from public.config where chave = p_chave
$$;

-- ---------------------------------------------------------------------
-- USUÁRIOS DO CRM (Ampliize e Advance). Só e-mails desta lista acessam.
-- ---------------------------------------------------------------------
create table if not exists public.crm_usuarios (
  email      text primary key,
  nome       text,
  papel      text not null default 'advance' check (papel in ('ampliize','advance','closer')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- LEADS
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id                    uuid primary key default gen_random_uuid(),
  telefone              text not null unique,
  nome                  text,
  nome_whatsapp         text,
  cpf_cnpj              text,
  email                 text,
  servico               text not null default 'indefinido'
                        check (servico in ('indefinido','diagnostico','limpa_nome')),
  objetivo              text,               -- limpar_nome | buscar_credito | entender_negativa | outro
  urgencia              text check (urgencia in ('alta','media','baixa')),
  etapa                 text not null default 'novo'
                        check (etapa in ('novo','em_atendimento','qualificado','proposta','pago',
                                         'agendado','concluido','perdido','desqualificado')),
  motivo_perda          text,
  origem                text not null default 'trafego_pago',   -- meta_ads | google_ads | trafego_pago | organico | indicacao
  anuncio               jsonb,                                   -- dados do anúncio (click-to-WhatsApp)
  consentimento_lgpd_em timestamptz,
  forma_pagamento       text check (forma_pagamento in ('avista','tap')),
  valor_previsto        numeric(10,2),
  valor_venda           numeric(10,2),
  pagamento_status      text not null default 'nenhum'
                        check (pagamento_status in ('nenhum','link_enviado','informado','confirmado')),
  documento_recebido    boolean not null default false,
  contrato_assinado     boolean not null default false,
  resumo                text,
  observacoes           text,
  tags                  text[] not null default '{}',
  primeira_msg_em       timestamptz,
  primeira_resposta_em  timestamptz,
  ultima_msg_lead_em    timestamptz,
  ultima_msg_ia_em      timestamptz,
  qualificado_em        timestamptz,
  proposta_em           timestamptz,
  pago_em               timestamptz,
  agendado_em           timestamptz,
  concluido_em          timestamptz,
  perdido_em            timestamptz,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists leads_etapa_idx on public.leads (etapa);
create index if not exists leads_criado_idx on public.leads (criado_em desc);

-- ---------------------------------------------------------------------
-- CONVERSAS (uma por lead) — estado da IA x humano
-- ---------------------------------------------------------------------
create table if not exists public.conversas (
  id                          uuid primary key default gen_random_uuid(),
  lead_id                     uuid not null unique references public.leads(id) on delete cascade,
  telefone                    text not null,
  jid                         text,
  modo                        text not null default 'ia' check (modo in ('ia','humano')),
  humano_ultima_atividade_em  timestamptz,      -- última msg do humano pelo número do atendimento
  assumida_manual             boolean not null default false,  -- botão "Assumir atendimento" no CRM
  assumida_por                text,
  assumida_em                 timestamptz,
  aguardando_humano           boolean not null default false,  -- IA transferiu e aguarda equipe
  motivo_handoff              text,
  handoff_em                  timestamptz,
  ultima_msg_em               timestamptz,
  nao_lidas                   int not null default 0,
  followup_etapa              int not null default 0,          -- 0..3 lembretes enviados
  followup_base_em            timestamptz,                     -- última msg da IA sem resposta
  criado_em                   timestamptz not null default now()
);
create index if not exists conversas_ultima_idx on public.conversas (ultima_msg_em desc);

-- ---------------------------------------------------------------------
-- MENSAGENS
-- ---------------------------------------------------------------------
create table if not exists public.mensagens (
  id              bigserial primary key,
  conversa_id     uuid not null references public.conversas(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  direcao         text not null check (direcao in ('in','out')),
  autor           text not null check (autor in ('lead','ia','humano','sistema')),
  tipo            text not null default 'text',   -- text | audio | image | document | video | sticker | ...
  texto           text,
  midia_descricao text,        -- transcrição do áudio / leitura da imagem
  media_url       text,
  wa_message_id   text unique,
  status_envio    text,        -- enviando | enviado | falhou
  processada_em   timestamptz, -- msgs do lead: quando a IA (ou humano) tratou
  criado_em       timestamptz not null default now()
);
create index if not exists mensagens_conv_idx on public.mensagens (conversa_id, id);
create index if not exists mensagens_pend_idx on public.mensagens (conversa_id) where direcao = 'in' and processada_em is null;
create index if not exists mensagens_criado_idx on public.mensagens (criado_em desc);

-- ---------------------------------------------------------------------
-- FUNIL (histórico de etapas) · REUNIÕES · ALERTAS · LOGS
-- ---------------------------------------------------------------------
create table if not exists public.eventos_funil (
  id          bigserial primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  etapa_de    text,
  etapa_para  text not null,
  motivo      text,
  por         text not null default 'sistema',
  criado_em   timestamptz not null default now()
);
create index if not exists eventos_funil_lead_idx on public.eventos_funil (lead_id, criado_em);
create index if not exists eventos_funil_data_idx on public.eventos_funil (criado_em desc);

create table if not exists public.reunioes (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  conversa_id     uuid references public.conversas(id) on delete set null,
  inicio          timestamptz not null,
  fim             timestamptz not null,
  status          text not null default 'reservando'
                  check (status in ('reservando','agendada','realizada','no_show','cancelada')),
  meet_link       text,
  google_event_id text,
  closer          text,
  observacao      text,
  criado_em       timestamptz not null default now()
);
create index if not exists reunioes_inicio_idx on public.reunioes (inicio);

create table if not exists public.alertas (
  id            bigserial primary key,
  tipo          text not null,      -- handoff | erro | pagamento_informado | reuniao_agendada | pausa_geral
  lead_id       uuid references public.leads(id) on delete cascade,
  conversa_id   uuid references public.conversas(id) on delete cascade,
  mensagem      text not null,
  lido          boolean not null default false,
  notificado_em timestamptz,
  criado_em     timestamptz not null default now()
);
create index if not exists alertas_pend_idx on public.alertas (criado_em) where notificado_em is null;

create table if not exists public.execucoes_agente (
  id            bigserial primary key,
  conversa_id   uuid references public.conversas(id) on delete cascade,
  n8n_execucao  text,
  entrada       text,
  saida         text,
  formato       text,
  erro          text,
  criado_em     timestamptz not null default now()
);

create table if not exists public.auditoria (
  id         bigserial primary key,
  acao       text not null,      -- pausa_geral | retomar_geral | assumir | devolver_ia | ...
  detalhe    jsonb,
  por        text,
  criado_em  timestamptz not null default now()
);

create table if not exists public.kb (
  id         serial primary key,
  categoria  text not null,
  pergunta   text not null,
  resposta   text not null,
  palavras   text,
  ativo      boolean not null default true,
  busca      tsvector generated always as (
               to_tsvector('portuguese', coalesce(categoria,'') || ' ' || coalesce(pergunta,'') || ' ' ||
                                         coalesce(resposta,'') || ' ' || coalesce(palavras,''))
             ) stored
);
create index if not exists kb_busca_idx on public.kb using gin (busca);

-- ---------------------------------------------------------------------
-- TRIGGERS: atualizado_em + histórico do funil + marcos de data
-- ---------------------------------------------------------------------
create or replace function public.tg_leads_etapa()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then
    case new.etapa
      when 'qualificado' then new.qualificado_em := coalesce(new.qualificado_em, now());
      when 'proposta'    then new.proposta_em    := coalesce(new.proposta_em, now());
      when 'pago'        then new.pago_em        := coalesce(new.pago_em, now());
      when 'agendado'    then new.agendado_em    := coalesce(new.agendado_em, now());
      when 'concluido'   then new.concluido_em   := coalesce(new.concluido_em, now());
      when 'perdido'     then new.perdido_em     := now();
      when 'desqualificado' then new.perdido_em  := now();
      else null;
    end case;
  end if;
  return new;
end $$;

drop trigger if exists leads_etapa on public.leads;
create trigger leads_etapa before insert or update on public.leads
for each row execute function public.tg_leads_etapa();

create or replace function public.tg_leads_funil()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then
    insert into public.eventos_funil (lead_id, etapa_de, etapa_para, motivo, por)
    values (new.id, case when tg_op = 'UPDATE' then old.etapa end, new.etapa,
            case when new.etapa in ('perdido','desqualificado') then new.motivo_perda end,
            coalesce(nullif(current_setting('adv.por', true), ''), 'sistema'));
  end if;
  return null;
end $$;

drop trigger if exists leads_funil on public.leads;
create trigger leads_funil after insert or update on public.leads
for each row execute function public.tg_leads_funil();

-- Ordem do funil (para nunca "voltar" etapa automaticamente)
create or replace function public.ordem_etapa(p text)
returns int language sql immutable as $$
  select case p when 'novo' then 0 when 'em_atendimento' then 1 when 'qualificado' then 2
                when 'proposta' then 3 when 'pago' then 4 when 'agendado' then 5
                when 'concluido' then 6 else -1 end
$$;

-- Avança etapa só se for "para frente" (perdido/desqualificado são laterais)
create or replace function public.avancar_etapa(p_lead uuid, p_etapa text, p_motivo text default null)
returns text language plpgsql as $$
declare v_atual text;
begin
  select etapa into v_atual from public.leads where id = p_lead for update;
  if p_etapa in ('perdido','desqualificado') then
    update public.leads set etapa = p_etapa, motivo_perda = coalesce(p_motivo, motivo_perda) where id = p_lead;
    return p_etapa;
  end if;
  if v_atual in ('perdido','desqualificado') or public.ordem_etapa(p_etapa) > public.ordem_etapa(v_atual) then
    update public.leads set etapa = p_etapa,
           motivo_perda = case when v_atual in ('perdido','desqualificado') then null else motivo_perda end
     where id = p_lead;
    return p_etapa;
  end if;
  return v_atual;
end $$;

-- ---------------------------------------------------------------------
-- REGRA DE INTERVENÇÃO HUMANA + PAUSA GERAL
-- IA ativa numa conversa  <=>  sistema não pausado
--                            e conversa não assumida no CRM
--                            e IA não está aguardando humano (handoff)
--                            e humano sem mensagens há >= N min (padrão 15)
-- ---------------------------------------------------------------------
create or replace function public.sdr_pausado()
returns boolean language sql stable as $$
  select coalesce((public.cfg('sdr_pausado_global') ->> 'pausado')::boolean, false)
$$;

create or replace function public.minutos_retorno_humano()
returns int language sql stable as $$
  select coalesce((public.cfg_txt('minutos_retorno_humano'))::int, 15)
$$;

create or replace function public.ia_ativa(c public.conversas)
returns boolean language sql stable as $$
  select not public.sdr_pausado()
     and not c.assumida_manual
     and not c.aguardando_humano
     and (c.humano_ultima_atividade_em is null
          or c.humano_ultima_atividade_em <= now() - make_interval(mins => public.minutos_retorno_humano()))
$$;

create or replace function public.ia_retorna_em(c public.conversas)
returns timestamptz language sql stable as $$
  select case when c.assumida_manual or c.aguardando_humano then null
              when c.humano_ultima_atividade_em is null then null
              else c.humano_ultima_atividade_em + make_interval(mins => public.minutos_retorno_humano()) end
$$;

-- Data por extenso em português (independe do locale do servidor)
create or replace function public.data_pt(p_ts timestamptz, p_ano boolean default false)
returns text language sql immutable as $$
  select (array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'])
           [extract(dow from p_ts at time zone 'America/Maceio')::int + 1]
         || ', ' || to_char(p_ts at time zone 'America/Maceio', case when p_ano then 'DD/MM/YYYY' else 'DD/MM' end)
         || ' às ' || to_char(p_ts at time zone 'America/Maceio', 'HH24:MI')
$$;

-- ---------------------------------------------------------------------
-- VALIDAÇÃO DE CPF/CNPJ
-- ---------------------------------------------------------------------
create or replace function public.documento_valido(p text)
returns boolean language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p,''), '\D', '', 'g');
        s int; r int; i int; pesos1 int[] := '{5,4,3,2,9,8,7,6,5,4,3,2}'; pesos2 int[] := '{6,5,4,3,2,9,8,7,6,5,4,3,2}';
begin
  if length(d) = 11 then
    if d ~ '^(\d)\1{10}$' then return false; end if;
    s := 0; for i in 1..9 loop s := s + substr(d,i,1)::int * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> substr(d,10,1)::int then return false; end if;
    s := 0; for i in 1..10 loop s := s + substr(d,i,1)::int * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = substr(d,11,1)::int;
  elsif length(d) = 14 then
    if d ~ '^(\d)\1{13}$' then return false; end if;
    s := 0; for i in 1..12 loop s := s + substr(d,i,1)::int * pesos1[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> substr(d,13,1)::int then return false; end if;
    s := 0; for i in 1..13 loop s := s + substr(d,i,1)::int * pesos2[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    return r = substr(d,14,1)::int;
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------------
-- ALERTA (vira notificação no WhatsApp da equipe + sino no CRM)
-- ---------------------------------------------------------------------
create or replace function public.criar_alerta(p_tipo text, p_conversa uuid, p_msg text)
returns bigint language plpgsql as $$
declare v_id bigint; v_lead uuid;
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  insert into public.alertas (tipo, lead_id, conversa_id, mensagem)
  values (p_tipo, v_lead, p_conversa, p_msg) returning id into v_id;
  return v_id;
end $$;

-- =====================================================================
-- ENTRADA DE MENSAGENS (chamado pelo n8n · ADV · WA Entrada)
-- p: { message_id, telefone, jid, from_me, tipo, texto, media_url, push_name, anuncio }
-- retorno.acao: processar | ignorar | humano | pausado
-- =====================================================================
create or replace function public.registrar_mensagem_entrada(p jsonb)
returns jsonb language plpgsql as $$
declare
  v_tel   text := regexp_replace(coalesce(p->>'telefone',''), '\D', '', 'g');
  v_wa    text := p->>'message_id';
  v_me    boolean := coalesce((p->>'from_me')::boolean, false);
  v_tipo  text := coalesce(p->>'tipo','text');
  v_texto text := nullif(p->>'texto','');
  v_lead  public.leads;
  v_conv  public.conversas;
  v_msg   bigint;
  v_eco   bigint;
  v_novo  boolean := false;
begin
  if v_tel = '' or v_wa is null then
    return jsonb_build_object('acao','ignorar','motivo','sem_telefone');
  end if;
  if exists (select 1 from public.mensagens where wa_message_id = v_wa) then
    return jsonb_build_object('acao','ignorar','motivo','duplicada');
  end if;

  -- lead + conversa
  select * into v_lead from public.leads where telefone = v_tel;
  if not found then
    if v_me then  -- humano iniciou conversa com número desconhecido: só registra o lead
      null;
    end if;
    insert into public.leads (telefone, nome_whatsapp, origem, anuncio, primeira_msg_em)
    values (v_tel, nullif(p->>'push_name',''),
            case when p ? 'anuncio' and p->'anuncio' <> 'null'::jsonb then 'meta_ads' else 'trafego_pago' end,
            nullif(p->'anuncio','null'::jsonb),
            case when v_me then null else now() end)
    returning * into v_lead;
    v_novo := true;
  end if;

  select * into v_conv from public.conversas where lead_id = v_lead.id for update;
  if not found then
    insert into public.conversas (lead_id, telefone, jid) values (v_lead.id, v_tel, p->>'jid')
    returning * into v_conv;
  end if;

  -- --------------------------------------------------- mensagem enviada pelo número
  if v_me then
    -- é eco de algo que a IA acabou de enviar?
    select id into v_eco from public.mensagens
     where conversa_id = v_conv.id and direcao = 'out' and autor in ('ia','sistema')
       and wa_message_id is null and criado_em > now() - interval '3 minutes'
       and (texto = v_texto or (v_tipo = 'audio' and tipo = 'audio'))
     order by id desc limit 1;
    if v_eco is not null then
      update public.mensagens set wa_message_id = v_wa, status_envio = 'enviado' where id = v_eco;
      return jsonb_build_object('acao','ignorar','motivo','eco_ia');
    end if;

    -- é um HUMANO respondendo pelo número do atendimento → IA para nesta conversa
    insert into public.mensagens (conversa_id, lead_id, direcao, autor, tipo, texto, media_url, wa_message_id, status_envio)
    values (v_conv.id, v_lead.id, 'out', 'humano', v_tipo, v_texto, p->>'media_url', v_wa, 'enviado');
    -- o humano assumiu o que estava pendente
    update public.mensagens set processada_em = now()
     where conversa_id = v_conv.id and direcao = 'in' and processada_em is null;
    update public.conversas
       set modo = 'humano', humano_ultima_atividade_em = now(), aguardando_humano = false,
           ultima_msg_em = now(), nao_lidas = 0, followup_etapa = 0, followup_base_em = null
     where id = v_conv.id;
    if v_lead.etapa = 'novo' then perform public.avancar_etapa(v_lead.id, 'em_atendimento'); end if;
    return jsonb_build_object('acao','ignorar','motivo','humano_respondeu','conversa_id', v_conv.id);
  end if;

  -- --------------------------------------------------- mensagem do lead
  insert into public.mensagens (conversa_id, lead_id, direcao, autor, tipo, texto, media_url, wa_message_id)
  values (v_conv.id, v_lead.id, 'in', 'lead', v_tipo, v_texto, p->>'media_url', v_wa)
  returning id into v_msg;

  update public.leads
     set ultima_msg_lead_em = now(),
         primeira_msg_em = coalesce(primeira_msg_em, now()),
         nome_whatsapp = coalesce(nome_whatsapp, nullif(p->>'push_name',''))
   where id = v_lead.id;
  update public.conversas
     set ultima_msg_em = now(), nao_lidas = nao_lidas + 1, followup_etapa = 0, followup_base_em = null,
         jid = coalesce(jid, p->>'jid')
   where id = v_conv.id
  returning * into v_conv;

  -- lead voltou a responder depois de "perdido por falta de resposta" → reabre
  if v_lead.etapa = 'perdido' and v_lead.motivo_perda = 'sem_resposta' then
    perform public.avancar_etapa(v_lead.id, 'em_atendimento');
  elsif v_lead.etapa = 'novo' then
    perform public.avancar_etapa(v_lead.id, 'em_atendimento');
  end if;

  return jsonb_build_object(
    'acao', case when public.sdr_pausado() then 'pausado'
                 when not public.ia_ativa(v_conv) then 'humano'
                 else 'processar' end,
    'conversa_id', v_conv.id,
    'lead_id', v_lead.id,
    'mensagem_id', v_msg,
    'telefone', v_tel,
    'nome', coalesce(v_lead.nome, v_lead.nome_whatsapp, nullif(p->>'push_name','')),
    'novo_lead', v_novo,
    'janela_segundos', coalesce((public.cfg_txt('janela_agrupamento_segundos'))::int, 8)
  );
end $$;

-- grava transcrição de áudio / leitura de imagem
create or replace function public.salvar_midia_descricao(p_msg bigint, p_desc text)
returns void language sql as $$
  update public.mensagens set midia_descricao = p_desc where id = p_msg
$$;

-- texto "legível" de uma mensagem para a IA
create or replace function public.texto_msg(m public.mensagens)
returns text language sql stable as $$
  select case
    when m.tipo = 'audio' then '[áudio] ' || coalesce(m.midia_descricao, '(não foi possível transcrever)')
    when m.tipo = 'image' then '[imagem' || coalesce(': ' || m.texto, '') || '] ' || coalesce(m.midia_descricao, '(não foi possível ler)')
    when m.tipo = 'document' then '[documento enviado: ' || coalesce(m.texto,'arquivo') || ']' || coalesce(' ' || m.midia_descricao, '')
    when m.tipo in ('video','sticker','location','contact') then '[' || m.tipo || coalesce(': ' || m.texto, '') || ']'
    else coalesce(m.texto, '')
  end
$$;

-- =====================================================================
-- AGRUPAMENTO: só a execução da ÚLTIMA mensagem responde o lote inteiro
-- =====================================================================
create or replace function public.coletar_lote(p_conversa uuid, p_msg bigint, p_forcar boolean default false)
returns jsonb language plpgsql as $$
declare v_conv public.conversas; v_ult bigint; v_prim bigint; v_txt text; v_audio boolean;
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
  select string_agg(public.texto_msg(m), E'\n' order by m.id), bool_or(m.tipo = 'audio')
    into v_txt, v_audio
    from public.mensagens m
   where m.conversa_id = p_conversa and m.direcao = 'in' and m.processada_em is null;
  update public.mensagens set processada_em = now()
   where conversa_id = p_conversa and direcao = 'in' and processada_em is null;
  update public.conversas set nao_lidas = 0 where id = p_conversa;
  return jsonb_build_object('processar', true, 'texto', v_txt, 'tinha_audio', coalesce(v_audio,false),
                            'primeiro_id', v_prim, 'ultimo_id', v_ult);
end $$;

-- Histórico para o agente (antes do lote atual)
create or replace function public.contexto_conversa(p_conversa uuid, p_qtd int, p_antes_de bigint)
returns text language sql stable as $$
  select coalesce(string_agg(linha, E'\n' order by id), '(primeira mensagem do lead)')
  from (
    select m.id,
           to_char(m.criado_em at time zone 'America/Maceio', 'DD/MM HH24:MI') || ' · ' ||
           case m.autor when 'lead' then 'Lead' when 'ia' then 'Você (consultor virtual)'
                        when 'humano' then 'Equipe Advance (humano)' else 'Sistema' end
           || ': ' || public.texto_msg(m) as linha
    from public.mensagens m
    where m.conversa_id = p_conversa and (p_antes_de is null or m.id < p_antes_de)
    order by m.id desc limit p_qtd
  ) h
$$;

-- Ficha do lead para o agente
create or replace function public.perfil_lead(p_conversa uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'nome', coalesce(l.nome, l.nome_whatsapp),
    'nome_completo_informado', l.nome is not null,
    'cpf_cnpj_informado', l.cpf_cnpj is not null,
    'email', l.email,
    'servico', l.servico,
    'objetivo', l.objetivo,
    'urgencia', l.urgencia,
    'etapa', l.etapa,
    'consentimento_lgpd', l.consentimento_lgpd_em is not null,
    'pagamento_status', l.pagamento_status,
    'forma_pagamento', l.forma_pagamento,
    'documento_recebido', l.documento_recebido,
    'origem', l.origem,
    'anuncio', l.anuncio ->> 'titulo',
    'reuniao', (select jsonb_build_object('inicio', to_char(r.inicio at time zone 'America/Maceio','DD/MM/YYYY HH24:MI'),
                                          'link', r.meet_link, 'status', r.status)
                  from public.reunioes r where r.lead_id = l.id and r.status in ('agendada','reservando')
                  order by r.inicio desc limit 1),
    'agora', public.data_pt(now(), true)
  )
  from public.conversas c join public.leads l on l.id = c.lead_id
  where c.id = p_conversa
$$;

-- =====================================================================
-- FERRAMENTAS DO AGENTE
-- =====================================================================

-- Atualiza a ficha do lead. Avança para "qualificado" quando completo.
create or replace function public.atualizar_lead(p_conversa uuid, p jsonb)
returns jsonb language plpgsql as $$
declare v_lead uuid; l public.leads; v_doc text; v_erros text[] := '{}'; v_falta text[] := '{}';
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  if v_lead is null then return jsonb_build_object('ok', false, 'erro','conversa_nao_encontrada'); end if;

  v_doc := nullif(regexp_replace(coalesce(p->>'cpf_cnpj',''), '\D', '', 'g'), '');
  if v_doc is not null and not public.documento_valido(v_doc) then
    v_erros := array_append(v_erros, 'cpf_cnpj_invalido');
    v_doc := null;
  end if;

  update public.leads set
    nome     = coalesce(nullif(trim(p->>'nome'),''), nome),
    cpf_cnpj = coalesce(v_doc, cpf_cnpj),
    email    = coalesce(nullif(lower(trim(p->>'email')),''), email),
    servico  = case when p->>'servico' in ('diagnostico','limpa_nome') then p->>'servico' else servico end,
    objetivo = coalesce(nullif(p->>'objetivo',''), objetivo),
    urgencia = case when p->>'urgencia' in ('alta','media','baixa') then p->>'urgencia' else urgencia end,
    consentimento_lgpd_em = case when coalesce((p->>'consentimento_lgpd')::boolean,false)
                                 then coalesce(consentimento_lgpd_em, now()) else consentimento_lgpd_em end,
    documento_recebido = documento_recebido or coalesce((p->>'documento_recebido')::boolean,false),
    resumo   = coalesce(nullif(p->>'resumo',''), resumo)
  where id = v_lead
  returning * into l;

  if l.nome is null then v_falta := array_append(v_falta, 'nome_completo'); end if;
  if l.cpf_cnpj is null then v_falta := array_append(v_falta, 'cpf_cnpj'); end if;
  if l.servico = 'indefinido' and l.objetivo is null then v_falta := array_append(v_falta, 'objetivo'); end if;
  if l.urgencia is null then v_falta := array_append(v_falta, 'urgencia'); end if;
  if l.consentimento_lgpd_em is null then v_falta := array_append(v_falta, 'consentimento_lgpd'); end if;

  if array_length(v_falta,1) is null then
    perform public.avancar_etapa(v_lead, 'qualificado');
  end if;

  return jsonb_build_object('ok', array_length(v_erros,1) is null, 'erros', v_erros,
                            'faltando', v_falta, 'qualificado', array_length(v_falta,1) is null,
                            'etapa', (select etapa from public.leads where id = v_lead));
end $$;

-- Lead perdeu interesse / fora do perfil
create or replace function public.marcar_perda(p_conversa uuid, p_tipo text, p_motivo text)
returns jsonb language plpgsql as $$
declare v_lead uuid;
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  perform public.avancar_etapa(v_lead, case when p_tipo = 'desqualificado' then 'desqualificado' else 'perdido' end, p_motivo);
  return jsonb_build_object('ok', true);
end $$;

-- Link de pagamento (configurado no CRM) + etapa "proposta"
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
  v_valor := case when p_servico = 'diagnostico' then 67 when v_forma = 'tap' then 1100 else 797 end;
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
                     when v_forma = 'tap' then 'Entrada de R$ 350,00 + 5x de R$ 150,00'
                     else 'R$ 797,00 à vista (PIX ou cartão)' end);
end $$;

-- Lead diz que pagou / mandou comprovante → equipe confere
create or replace function public.informar_pagamento(p_conversa uuid, p_detalhe text)
returns jsonb language plpgsql as $$
declare v_lead uuid;
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  update public.leads set pagamento_status = 'informado'
   where id = v_lead and pagamento_status <> 'confirmado';
  perform public.criar_alerta('pagamento_informado', p_conversa, 'Lead informou pagamento: ' || coalesce(p_detalhe,'') || '. Confirme no meio de pagamento e marque como pago no CRM.');
  return jsonb_build_object('ok', true, 'orientacao',
    'Agradeça, diga que o financeiro vai confirmar e siga para o próximo passo (documento de identificação e agendamento).');
end $$;

-- Pagamento confirmado (webhook do meio de pagamento ou botão no CRM)
create or replace function public.confirmar_pagamento(p_lead uuid, p_valor numeric, p_forma text, p_por text default 'sistema')
returns jsonb language plpgsql as $$
declare v_conv uuid; l public.leads;
begin
  perform set_config('adv.por', coalesce(p_por,'sistema'), true);
  update public.leads set pagamento_status = 'confirmado', pago_em = coalesce(pago_em, now()),
         valor_venda = coalesce(p_valor, valor_previsto, valor_venda),
         forma_pagamento = coalesce(p_forma, forma_pagamento)
   where id = p_lead returning * into l;
  if not found then return jsonb_build_object('ok', false, 'erro', 'lead_nao_encontrado'); end if;
  perform public.avancar_etapa(p_lead, 'pago');
  select id into v_conv from public.conversas where lead_id = p_lead;
  -- mensagem de sistema para a IA continuar a conversa (o ADV · Retomada pega em até 1 min)
  insert into public.mensagens (conversa_id, lead_id, direcao, autor, tipo, texto)
  values (v_conv, p_lead, 'in', 'sistema', 'text',
          '[SISTEMA] Pagamento de R$ ' || coalesce(l.valor_venda::text, '?') || ' confirmado. Agradeça e conduza o próximo passo: '
          || case when l.documento_recebido then 'agendar a reunião com o especialista.'
                  else 'pedir o documento de identificação completo (RG ou CNH, frente e verso) e depois agendar a reunião.' end);
  return jsonb_build_object('ok', true, 'lead_id', p_lead);
end $$;

-- Handoff: IA silencia e a equipe é avisada
create or replace function public.iniciar_handoff(p_conversa uuid, p_motivo text, p_resumo text)
returns jsonb language plpgsql as $$
begin
  update public.conversas set aguardando_humano = true, modo = 'humano', motivo_handoff = p_motivo, handoff_em = now()
   where id = p_conversa;
  perform public.criar_alerta('handoff', p_conversa, 'Transferência (' || coalesce(p_motivo,'') || '): ' || coalesce(p_resumo,''));
  return jsonb_build_object('ok', true, 'orientacao', 'Transferido. Se ainda não avisou o lead, diga em 1 frase que um especialista vai continuar o atendimento.');
end $$;

-- Aviso à equipe SEM tirar a IA da conversa (ex.: enviar contrato do Limpa Nome)
create or replace function public.avisar_equipe(p_conversa uuid, p_motivo text, p_texto text)
returns jsonb language plpgsql as $$
begin
  if p_motivo = 'contrato' then
    update public.leads set documento_recebido = true where id = (select lead_id from public.conversas where id = p_conversa);
  end if;
  perform public.criar_alerta('handoff', p_conversa, 'Aviso (' || coalesce(p_motivo,'') || '): ' || coalesce(p_texto,''));
  return jsonb_build_object('ok', true, 'orientacao', 'Equipe avisada. Continue o atendimento normalmente.');
end $$;

-- Base de conhecimento
create or replace function public.buscar_kb(p_texto text, p_limite int default 5)
returns table (categoria text, pergunta text, resposta text)
language sql stable as $$
  select k.categoria, k.pergunta, k.resposta
  from public.kb k
  where k.ativo
    and (k.busca @@ websearch_to_tsquery('portuguese', p_texto)
         or k.busca @@ plainto_tsquery('portuguese', p_texto)
         or k.pergunta ilike '%' || p_texto || '%')
  order by ts_rank(k.busca, plainto_tsquery('portuguese', p_texto)) desc
  limit p_limite
$$;

create or replace function public.buscar_kb_json(p_texto text)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
  from (
    select * from public.buscar_kb(p_texto, 5)
    union
    -- fallback: busca por qualquer palavra relevante
    select * from public.buscar_kb(
      array_to_string(array(select w from regexp_split_to_table(lower(p_texto), '\W+') w where length(w) > 3), ' | ')::text, 3)
  ) b
$$;

-- =====================================================================
-- AGENDA DO ESPECIALISTA (closer) · reunião no Google Meet
-- cfg agenda_closer: {"dias":[1..5], "inicio":"09:00","fim":"18:00",
--   "almoco":["12:00","13:30"], "duracao_min":30, "antecedencia_horas":2, "dias_a_frente":7}
-- =====================================================================
create or replace function public.horarios_livres(p_data date default null, p_qtd int default 6)
returns jsonb language plpgsql stable as $$
declare
  a jsonb := coalesce(public.cfg('agenda_closer'), '{}'::jsonb);
  v_dur int := coalesce((a->>'duracao_min')::int, 30);
  v_ini time := coalesce((a->>'inicio')::time, '09:00');
  v_fim time := coalesce((a->>'fim')::time, '18:00');
  v_alm_i time := coalesce((a->'almoco'->>0)::time, '12:00');
  v_alm_f time := coalesce((a->'almoco'->>1)::time, '13:30');
  v_ant interval := make_interval(hours => coalesce((a->>'antecedencia_horas')::int, 2));
  v_dias int[] := coalesce(array(select jsonb_array_elements_text(a->'dias')::int), '{1,2,3,4,5}');
  v_frente int := coalesce((a->>'dias_a_frente')::int, 7);
  v_bloq jsonb := coalesce(a->'bloqueios', '[]'::jsonb);
  v_hoje date := (now() at time zone 'America/Maceio')::date;
  v_res jsonb := '[]'::jsonb;
  d date; t time; ts timestamptz; n int := 0;
begin
  for d in select generate_series(coalesce(p_data, v_hoje), coalesce(p_data, v_hoje + v_frente), interval '1 day')::date loop
    continue when not (extract(isodow from d)::int = any (v_dias));
    continue when v_bloq ? d::text;
    t := v_ini;
    while t + make_interval(mins => v_dur) <= v_fim loop
      if not (t < v_alm_f and t + make_interval(mins => v_dur) > v_alm_i) then
        ts := (d + t) at time zone 'America/Maceio';
        if ts >= now() + v_ant and not exists (
             select 1 from public.reunioes r
              where r.status in ('reservando','agendada')
                and tstzrange(r.inicio, r.fim) && tstzrange(ts, ts + make_interval(mins => v_dur))) then
          v_res := v_res || jsonb_build_object(
            'inicio', to_char(ts at time zone 'America/Maceio', 'YYYY-MM-DD"T"HH24:MI:00-03:00'),
            'legivel', public.data_pt(ts));
          n := n + 1;
          exit when p_data is null and n >= p_qtd;
        end if;
      end if;
      t := t + make_interval(mins => v_dur);
    end loop;
    exit when p_data is null and n >= p_qtd;
  end loop;
  return jsonb_build_object('fuso','America/Maceio (horário de Aracaju)', 'duracao_min', v_dur, 'horarios', v_res);
end $$;

create or replace function public.reservar_reuniao(p_conversa uuid, p_inicio timestamptz)
returns jsonb language plpgsql as $$
declare
  c public.conversas; l public.leads; v_id uuid; v_dur int;
  v_exige boolean := coalesce((public.cfg_txt('exigir_pagamento_para_agendar'))::boolean, true);
begin
  select * into c from public.conversas where id = p_conversa;
  select * into l from public.leads where id = c.lead_id;
  v_dur := coalesce((public.cfg('agenda_closer')->>'duracao_min')::int, 30);
  if l.nome is null then
    return jsonb_build_object('ok', false, 'orientacao', 'Antes de agendar, peça o nome completo do lead.');
  end if;
  if v_exige and l.servico = 'diagnostico' and l.pagamento_status not in ('informado','confirmado') then
    return jsonb_build_object('ok', false, 'orientacao',
      'A reunião do Diagnóstico é agendada depois do pagamento (R$ 67). Envie o link com gerar_link_pagamento e agende quando ele pagar.');
  end if;
  if not exists (select 1 from jsonb_array_elements(public.horarios_livres((p_inicio at time zone 'America/Maceio')::date, 50)->'horarios') h
                  where (h->>'inicio')::timestamptz = p_inicio) then
    return jsonb_build_object('ok', false, 'orientacao', 'Horário indisponível. Consulte consultar_horarios e ofereça outro.',
                              'alternativas', public.horarios_livres(null, 3)->'horarios');
  end if;
  -- cancela reserva anterior pendente/agendada (remarcação)
  update public.reunioes set status = 'cancelada', observacao = 'remarcada pelo lead'
   where lead_id = l.id and status in ('reservando','agendada') and inicio > now();
  insert into public.reunioes (lead_id, conversa_id, inicio, fim, status)
  values (l.id, c.id, p_inicio, p_inicio + make_interval(mins => v_dur), 'reservando')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'reuniao_id', v_id,
    'inicio', to_char(p_inicio at time zone 'America/Maceio', 'YYYY-MM-DD"T"HH24:MI:00-03:00'),
    'fim', to_char((p_inicio + make_interval(mins => v_dur)) at time zone 'America/Maceio', 'YYYY-MM-DD"T"HH24:MI:00-03:00'),
    'nome', l.nome, 'email', l.email, 'telefone', l.telefone, 'servico', l.servico,
    'resumo', coalesce(l.resumo, ''), 'urgencia', l.urgencia);
end $$;

create or replace function public.confirmar_reuniao(p_reuniao uuid, p_event text, p_link text)
returns jsonb language plpgsql as $$
declare r public.reunioes; v_txt text;
begin
  update public.reunioes set status = 'agendada', google_event_id = p_event, meet_link = p_link
   where id = p_reuniao returning * into r;
  perform public.avancar_etapa(r.lead_id, 'agendado');
  v_txt := public.data_pt(r.inicio);
  perform public.criar_alerta('reuniao_agendada', r.conversa_id, 'Reunião agendada para ' || v_txt || ' · ' || coalesce(p_link,''));
  return jsonb_build_object('ok', true, 'quando', v_txt, 'meet_link', p_link);
end $$;

create or replace function public.cancelar_reserva(p_reuniao uuid, p_motivo text)
returns void language sql as $$
  update public.reunioes set status = 'cancelada', observacao = p_motivo where id = p_reuniao and status = 'reservando'
$$;

-- =====================================================================
-- SAÍDA DE MENSAGENS (ADV · WA Enviar)
-- =====================================================================
-- Checa se pode enviar AGORA (pausa geral/humano podem ter entrado no meio)
create or replace function public.preparar_envio(p_conversa uuid, p_tipo text, p_texto text, p_autor text default 'ia')
returns jsonb language plpgsql as $$
declare c public.conversas; v_id bigint; v_ult timestamptz; v_int int;
begin
  select * into c from public.conversas where id = p_conversa;
  -- a IA pode mandar a frase de transferência logo após transferir (até 3 min)
  if p_autor = 'ia' and not public.ia_ativa(c)
     and not (c.aguardando_humano and not c.assumida_manual and not public.sdr_pausado()
              and c.handoff_em > now() - interval '3 minutes'
              and (c.humano_ultima_atividade_em is null or c.humano_ultima_atividade_em < c.handoff_em)) then
    return jsonb_build_object('permitido', false, 'motivo', case when public.sdr_pausado() then 'pausa_geral' else 'humano_na_conversa' end);
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

create or replace function public.confirmar_envio(p_msg bigint, p_wa text, p_ok boolean)
returns void language plpgsql as $$
declare m public.mensagens;
begin
  update public.mensagens
     set wa_message_id = coalesce(wa_message_id, nullif(p_wa,'')),
         status_envio = case when p_ok then 'enviado' else 'falhou' end
   where id = p_msg returning * into m;
  if p_ok and m.autor = 'ia' then
    update public.leads set ultima_msg_ia_em = now(), primeira_resposta_em = coalesce(primeira_resposta_em, now())
     where id = m.lead_id;
    update public.conversas set ultima_msg_em = now(),
           followup_base_em = case when followup_etapa = 0 then now() else followup_base_em end
     where id = m.conversa_id;
  elsif p_ok and m.autor = 'sistema' then
    update public.conversas set ultima_msg_em = now() where id = m.conversa_id;
  end if;
end $$;

-- Formato da resposta: texto ou áudio (voz clonada)
create or replace function public.decidir_formato(p_tinha_audio boolean, p_texto text)
returns text language sql stable as $$
  select case
    when coalesce(public.cfg_txt('audio_modo'),'espelhar') = 'nunca' then 'texto'
    when nullif(public.cfg_txt('elevenlabs_voice_id'),'') is null then 'texto'
    when p_texto ~* '(https?://|www\.|\d{3}\.\d{3}\.\d{3}|R\$\s*\d)' then 'texto'   -- links, CPF e valores sempre por escrito
    when length(p_texto) > coalesce((public.cfg_txt('audio_max_caracteres'))::int, 600) then 'texto'
    when public.cfg_txt('audio_modo') = 'sempre' then 'audio'
    when p_tinha_audio then 'audio'
    else 'texto' end
$$;

create or replace function public.registrar_execucao(p_conversa uuid, p_exec text, p_entrada text, p_saida text, p_formato text, p_erro text default null)
returns jsonb language plpgsql as $$
declare v_novas boolean;
begin
  insert into public.execucoes_agente (conversa_id, n8n_execucao, entrada, saida, formato, erro)
  values (p_conversa, p_exec, p_entrada, p_saida, p_formato, p_erro);
  select exists (select 1 from public.mensagens where conversa_id = p_conversa and direcao = 'in' and processada_em is null) into v_novas;
  return jsonb_build_object('chegou_nova', v_novas);
end $$;

-- =====================================================================
-- ROTINAS (ADV · Retomada e Follow-up · roda a cada minuto)
-- =====================================================================
-- 1) Devolve à IA conversas cujo humano ficou 15 min sem responder
-- 2) Retorna conversas com mensagens pendentes para a IA responder
create or replace function public.retomar_conversas()
returns setof jsonb language plpgsql as $$
declare c public.conversas; v_lote jsonb; v_ult bigint;
begin
  if public.sdr_pausado() then return; end if;

  for c in select * from public.conversas
            where modo = 'humano' and not assumida_manual and not aguardando_humano
              and humano_ultima_atividade_em <= now() - make_interval(mins => public.minutos_retorno_humano())
            for update skip locked loop
    update public.conversas set modo = 'ia' where id = c.id;
    insert into public.auditoria (acao, detalhe, por)
    values ('ia_retomou', jsonb_build_object('conversa_id', c.id, 'apos_minutos', public.minutos_retorno_humano()), 'sistema');
  end loop;

  for c in select cv.* from public.conversas cv
            where exists (select 1 from public.mensagens m where m.conversa_id = cv.id and m.direcao = 'in' and m.processada_em is null)
              and (select max(m.criado_em) from public.mensagens m where m.conversa_id = cv.id and m.direcao = 'in' and m.processada_em is null)
                  < now() - interval '45 seconds'
            for update skip locked loop
    continue when not public.ia_ativa(c);
    select max(id) into v_ult from public.mensagens where conversa_id = c.id and direcao = 'in' and processada_em is null;
    v_lote := public.coletar_lote(c.id, v_ult, true);
    if (v_lote->>'processar')::boolean then
      return next v_lote || jsonb_build_object('conversa_id', c.id, 'telefone', c.telefone, 'origem', 'retomada',
        'nome', (select coalesce(nome, nome_whatsapp) from public.leads where id = c.lead_id));
    end if;
  end loop;
end $$;

-- Régua de follow-up: 2h, 24h e 48h após a última mensagem da IA sem resposta.
-- Depois do 3º lembrete + 24h sem resposta → lead "perdido · sem_resposta".
create or replace function public.followups_devidos()
returns setof jsonb language plpgsql as $$
declare
  c record;
  v_h int[] := coalesce(array(select jsonb_array_elements_text(public.cfg('followup_horas'))::int), '{2,24,48}');
  v_tpl jsonb := coalesce(public.cfg('followup_mensagens'), '[]'::jsonb);
  v_jan jsonb := coalesce(public.cfg('followup_janela'), '{"inicio":"08:00","fim":"20:00"}'::jsonb);
  v_agora time := (now() at time zone 'America/Maceio')::time;
  v_txt text;
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
              and l.etapa in ('em_atendimento','qualificado','proposta')
              and (l.ultima_msg_lead_em is null or l.ultima_msg_lead_em < cv.followup_base_em)
              and not exists (select 1 from public.mensagens m where m.conversa_id = cv.id and m.direcao='in' and m.processada_em is null)
            for update of cv skip locked loop
    continue when not public.ia_ativa((select x from public.conversas x where x.id = c.id));
    v_txt := coalesce(v_tpl->>c.followup_etapa,
      case c.followup_etapa when 0 then 'Oi, {nome}! Conseguiu ver minha última mensagem? Fico por aqui pra te ajudar 😊'
                            when 1 then '{nome}, passando para saber se ainda posso te ajudar com seu crédito. Quer seguir?'
                            else '{nome}, vou encerrar seu atendimento por aqui. Se quiser retomar, é só me chamar!' end);
    v_txt := replace(v_txt, '{nome}', coalesce(split_part(coalesce(c.nome, c.nome_whatsapp), ' ', 1), ''));
    v_txt := regexp_replace(v_txt, '^\s*,\s*', '');
    update public.conversas set followup_etapa = followup_etapa + 1 where id = c.id;
    return next jsonb_build_object('conversa_id', c.id, 'telefone', c.telefone, 'texto', v_txt,
                                   'etapa_followup', c.followup_etapa + 1);
  end loop;
end $$;

-- Alertas ainda não enviados para o WhatsApp da equipe
create or replace function public.alertas_para_notificar()
returns setof jsonb language plpgsql as $$
declare a record; v_nums text[];
begin
  v_nums := array(select regexp_replace(x, '\D', '', 'g') from jsonb_array_elements_text(coalesce(public.cfg('whatsapp_equipe'),'[]'::jsonb)) x);
  for a in select al.*, l.telefone, coalesce(l.nome, l.nome_whatsapp, l.telefone) as quem
             from public.alertas al left join public.leads l on l.id = al.lead_id
            where al.notificado_em is null and al.criado_em > now() - interval '6 hours'
              and al.tipo in ('handoff','erro','pagamento_informado','reuniao_agendada','pausa_geral')
            order by al.id limit 20 for update of al skip locked loop
    update public.alertas set notificado_em = now() where id = a.id;
    continue when array_length(v_nums,1) is null;
    return next jsonb_build_object('alerta_id', a.id, 'numeros', to_jsonb(v_nums),
      'texto', '🔔 *SDR Advance · ' || replace(a.tipo,'_',' ') || '*' || E'\n' ||
               coalesce('Lead: ' || a.quem || ' (wa.me/' || a.telefone || ')' || E'\n', '') || a.mensagem);
  end loop;
end $$;

-- =====================================================================
-- AÇÕES DO CRM (chamadas pelo front com o usuário logado)
-- =====================================================================
create or replace function public.crm_email()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'crm')
$$;

create or replace function public.is_crm_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crm_usuarios u where u.email = lower(public.crm_email()) and u.ativo)
$$;

-- Botão de EMERGÊNCIA: pausa/retoma todo o SDR IA
create or replace function public.crm_pausa_geral(p_pausar boolean, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_por text := public.crm_email();
begin
  if not public.is_crm_user() then raise exception 'acesso negado'; end if;
  insert into public.config (chave, valor, descricao, atualizado_em, atualizado_por)
  values ('sdr_pausado_global', jsonb_build_object('pausado', p_pausar, 'motivo', p_motivo, 'por', v_por, 'em', now()),
          'Pausa geral de emergência do SDR IA', now(), v_por)
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now(), atualizado_por = v_por;
  insert into public.auditoria (acao, detalhe, por)
  values (case when p_pausar then 'pausa_geral' else 'retomar_geral' end, jsonb_build_object('motivo', p_motivo), v_por);
  insert into public.alertas (tipo, mensagem)
  values ('pausa_geral', case when p_pausar then '⛔ SDR IA PAUSADO por ' || v_por || coalesce(' · motivo: ' || p_motivo, '')
                              else '✅ SDR IA reativado por ' || v_por end);
  return jsonb_build_object('ok', true, 'pausado', p_pausar);
end $$;

-- Botão "Assumir atendimento" (IA fica fora até devolver)
create or replace function public.crm_assumir(p_conversa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_por text := public.crm_email();
begin
  if not public.is_crm_user() then raise exception 'acesso negado'; end if;
  update public.conversas set assumida_manual = true, assumida_por = v_por, assumida_em = now(),
         modo = 'humano', aguardando_humano = false
   where id = p_conversa;
  insert into public.auditoria (acao, detalhe, por) values ('assumir', jsonb_build_object('conversa_id', p_conversa), v_por);
  return jsonb_build_object('ok', true);
end $$;

-- Botão "Devolver para a IA"
create or replace function public.crm_devolver_ia(p_conversa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_por text := public.crm_email();
begin
  if not public.is_crm_user() then raise exception 'acesso negado'; end if;
  update public.conversas set assumida_manual = false, assumida_por = null, assumida_em = null,
         aguardando_humano = false, motivo_handoff = null, humano_ultima_atividade_em = null, modo = 'ia'
   where id = p_conversa;
  insert into public.auditoria (acao, detalhe, por) values ('devolver_ia', jsonb_build_object('conversa_id', p_conversa), v_por);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.crm_mover_etapa(p_lead uuid, p_etapa text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crm_user() then raise exception 'acesso negado'; end if;
  perform set_config('adv.por', public.crm_email(), true);
  update public.leads set etapa = p_etapa,
         motivo_perda = case when p_etapa in ('perdido','desqualificado') then coalesce(p_motivo, motivo_perda) else null end
   where id = p_lead;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.crm_confirmar_pagamento(p_lead uuid, p_valor numeric, p_forma text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crm_user() then raise exception 'acesso negado'; end if;
  return public.confirmar_pagamento(p_lead, p_valor, p_forma, public.crm_email());
end $$;

-- =====================================================================
-- VIEW para o CRM: conversas com status da IA calculado
-- =====================================================================
create or replace view public.vw_conversas with (security_invoker = true) as
select c.*,
       public.ia_ativa(c) as ia_ativa,
       public.ia_retorna_em(c) as ia_retorna_em,
       l.nome, l.nome_whatsapp, l.etapa, l.servico, l.urgencia, l.origem, l.pagamento_status,
       (select public.texto_msg(m) from public.mensagens m where m.conversa_id = c.id order by m.id desc limit 1) as ultima_msg_texto,
       (select m.autor from public.mensagens m where m.conversa_id = c.id order by m.id desc limit 1) as ultima_msg_autor
from public.conversas c join public.leads l on l.id = c.lead_id;

-- =====================================================================
-- SEGURANÇA (RLS): só usuários cadastrados em crm_usuarios.
-- O n8n usa a conexão Postgres direta (role postgres), que ignora RLS.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['config','crm_usuarios','leads','conversas','mensagens','eventos_funil',
                           'reunioes','alertas','execucoes_agente','auditoria','kb'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists crm_all on public.%I', t);
    execute format('create policy crm_all on public.%I for all to authenticated using (public.is_crm_user()) with check (public.is_crm_user())', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.crm_pausa_geral(boolean, text), public.crm_assumir(uuid), public.crm_devolver_ia(uuid),
                         public.crm_mover_etapa(uuid, text, text), public.crm_confirmar_pagamento(uuid, numeric, text),
                         public.is_crm_user(), public.crm_email(), public.ia_ativa(public.conversas),
                         public.ia_retorna_em(public.conversas), public.texto_msg(public.mensagens),
                         public.sdr_pausado(), public.minutos_retorno_humano(), public.cfg(text), public.cfg_txt(text),
                         public.horarios_livres(date, int)
  to authenticated;

-- Realtime para o CRM atualizar ao vivo
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.mensagens; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.conversas; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.leads; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.config; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.alertas; exception when duplicate_object then null; end;
  end if;
end $$;
