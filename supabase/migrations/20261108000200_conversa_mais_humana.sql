-- Conversa mais humana: urgência deduzida (não perguntada), números da equipe
-- ignorados pela IA e respostas aprovadas pela equipe na base.

-- 1) Números da equipe (config whatsapp_equipe) não são leads: a IA não responde
--    nem cria ficha. A função original passa a se chamar registrar_mensagem_entrada_base.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'registrar_mensagem_entrada_base') then
    alter function public.registrar_mensagem_entrada(jsonb) rename to registrar_mensagem_entrada_base;
  end if;
end $$;

create or replace function public.eh_numero_equipe(p_tel text)
returns boolean language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements_text(coalesce(public.cfg('whatsapp_equipe'), '[]'::jsonb)) x
     where regexp_replace(x, '\D', '', 'g') <> ''
       and regexp_replace(x, '\D', '', 'g') = regexp_replace(coalesce(p_tel, ''), '\D', '', 'g')
  )
$$;

create or replace function public.registrar_mensagem_entrada(p jsonb)
returns jsonb language plpgsql as $$
begin
  if public.eh_numero_equipe(p->>'telefone')
     and not exists (select 1 from public.leads l
                      where l.telefone = regexp_replace(coalesce(p->>'telefone',''), '\D', '', 'g')
                        and exists (select 1 from public.contratos ct where ct.lead_id = l.id)) then
    return jsonb_build_object('acao', 'ignorar', 'motivo', 'numero_da_equipe');
  end if;
  return public.registrar_mensagem_entrada_base(p);
end $$;

-- 2) Urgência: a IA deduz da conversa. Quando faltar, o retorno avisa para NÃO perguntar.
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

  -- com nome e documento já salvos, urgência não informada vira "media" (não trava o funil)
  if l.urgencia is null and l.nome is not null and l.cpf_cnpj is not null then
    update public.leads set urgencia = 'media' where id = v_lead returning * into l;
  end if;

  if l.nome is null then v_falta := array_append(v_falta, 'nome_completo'); end if;
  if l.cpf_cnpj is null then v_falta := array_append(v_falta, 'cpf_cnpj'); end if;
  if l.servico = 'indefinido' and l.objetivo is null then v_falta := array_append(v_falta, 'objetivo'); end if;
  if l.urgencia is null then v_falta := array_append(v_falta, 'urgencia (deduza pela conversa e salve; NUNCA pergunte ao lead)'); end if;
  if l.consentimento_lgpd_em is null then v_falta := array_append(v_falta, 'consentimento_lgpd'); end if;

  if array_length(v_falta,1) is null then
    perform public.avancar_etapa(v_lead, 'qualificado');
  end if;

  return jsonb_build_object('ok', array_length(v_erros,1) is null, 'erros', v_erros,
                            'faltando', v_falta, 'qualificado', array_length(v_falta,1) is null,
                            'orientacao', 'Pergunte só o que falta, um por vez, e só se fizer sentido agora. Não repita perguntas já feitas.',
                            'etapa', (select etapa from public.leads where id = v_lead));
end $$;

-- 3) Respostas que a equipe deu nas conversas reais
insert into public.kb (categoria, pergunta, resposta, palavras)
select v.categoria, v.pergunta, v.resposta, v.palavras
  from (values
    ('limpa_nome', 'Vocês limpam CNPJ? Funciona para empresa?',
     'Sim, o Limpa Nome também é feito para CNPJ, com as mesmas condições.',
     'cnpj empresa pj pessoa jurídica juridica mei limpa cnpj'),
    ('limpa_nome', 'Remove protesto do Cenprot / cartório?',
     'Não. Entram só os protestos que estiverem aparecendo no Serasa.',
     'cenprot protesto cartório cartorio protestado título titulo')
  ) as v(categoria, pergunta, resposta, palavras)
 where not exists (select 1 from public.kb k where k.pergunta = v.pergunta);
