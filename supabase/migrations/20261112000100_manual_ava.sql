-- Manual de treinamento da Ava (Advance, 12/11/2026)
-- 1) A IA NÃO volta sozinha depois que a equipe responde: só quando a equipe clicar em "Devolver para a IA"
--    (config ia_retorno_automatico = false; ligada, volta como antes, depois de minutos_retorno_humano).
-- 2) Clientes da base (vendas passadas) não são atendidos pela IA: ficam com a equipe.
--    Base = número na lista clientes_base (Configurações) ou contrato pago há mais de 3 dias.
-- 3) Textos do link: a 2ª parcela (2x) e a 1ª parcela da TAP vencem 2 dias depois do nome limpo.
-- 4) Base de conhecimento com as respostas aprovadas no manual (prazo 30 a 45 dias úteis).

insert into public.config (chave, valor, descricao) values
  ('ia_retorno_automatico', 'false', 'Se a IA volta sozinha para a conversa depois que a equipe respondeu (false = só com "Devolver para a IA")'),
  ('clientes_base', '[]', 'Telefones de clientes antigos: a IA não responde, a conversa vai para a equipe'),
  ('nome_agente', '"Ava"', 'Nome da consultora virtual')
on conflict (chave) do nothing;
update public.config set valor = '"Ava"' where chave = 'nome_agente';

alter table public.conversas add column if not exists base_liberada_em timestamptz;

create or replace function public.ia_retorno_automatico()
returns boolean language sql stable as $$
  select coalesce((public.cfg_txt('ia_retorno_automatico'))::boolean, false)
$$;

create or replace function public.ia_ativa(c public.conversas)
returns boolean language sql stable as $$
  select not public.sdr_pausado()
     and not c.assumida_manual
     and not c.aguardando_humano
     and (c.humano_ultima_atividade_em is null
          or (public.ia_retorno_automatico()
              and c.humano_ultima_atividade_em <= now() - make_interval(mins => public.minutos_retorno_humano())))
$$;

create or replace function public.ia_retorna_em(c public.conversas)
returns timestamptz language sql stable as $$
  select case when c.assumida_manual or c.aguardando_humano then null
              when c.humano_ultima_atividade_em is null then null
              when not public.ia_retorno_automatico() then null
              else c.humano_ultima_atividade_em + make_interval(mins => public.minutos_retorno_humano()) end
$$;

-- conversas que a IA já tinha retomado continuam com a IA (a regra nova vale para as próximas respostas da equipe)
update public.conversas set humano_ultima_atividade_em = null, modo = 'ia'
 where not assumida_manual and not aguardando_humano and humano_ultima_atividade_em is not null
   and humano_ultima_atividade_em <= now() - make_interval(mins => public.minutos_retorno_humano());

-- "Devolver para a IA" também libera cliente da base
create or replace function public.crm_devolver_ia(p_conversa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_por text := public.crm_email();
begin
  if not public.is_crm_user() then raise exception 'acesso negado'; end if;
  update public.conversas set assumida_manual = false, assumida_por = null, assumida_em = null,
         aguardando_humano = false, motivo_handoff = null, humano_ultima_atividade_em = null, modo = 'ia',
         base_liberada_em = coalesce(base_liberada_em, now())
   where id = p_conversa;
  insert into public.auditoria (acao, detalhe, por) values ('devolver_ia', jsonb_build_object('conversa_id', p_conversa), v_por);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.eh_cliente_base(p_lead uuid)
returns boolean language sql stable as $$
  select exists (select 1 from public.leads l
                  join jsonb_array_elements_text(coalesce(public.cfg('clientes_base'), '[]'::jsonb)) x
                    on regexp_replace(x, '\D', '', 'g') <> ''
                   and right(regexp_replace(l.telefone, '\D', '', 'g'), 10) = right(regexp_replace(x, '\D', '', 'g'), 10)
                 where l.id = p_lead)
      or exists (select 1 from public.contratos ct
                  where ct.lead_id = p_lead and ct.status in ('ativo','inadimplente','quitado')
                    and coalesce(ct.aderido_em, ct.criado_em) < now() - interval '3 days')
$$;

create or replace function public.condicao_texto(p_servico text, p_modalidade text)
returns text language sql stable as $$
  select case
    when p_servico = 'personalizada' then 'cobrança personalizada (PIX ou boleto)'
    when p_servico = 'diagnostico' then public.brl((public.plano_parcelas('diagnostico','avista'))[1]) || ' à vista (PIX ou boleto)'
    when p_modalidade = 'avista' then public.brl((public.plano_parcelas(p_servico,'avista'))[1]) || ' à vista (PIX ou boleto)'
    when p_modalidade = '2x' then '2x de ' || public.brl((public.plano_parcelas(p_servico,'2x'))[1])
                                  || case when p_servico = 'rating' then ': a 1ª agora e a 2ª na entrega do serviço (PIX ou boleto)'
                                          else ': a 1ª agora e a 2ª vence 2 dias depois que o seu nome estiver limpo (PIX ou boleto)' end
    else 'Entrada de ' || public.brl((public.plano_parcelas(p_servico,'tap'))[1]) || ' agora + '
         || (array_length(public.plano_parcelas(p_servico,'tap'),1) - 1) || 'x de '
         || public.brl((public.plano_parcelas(p_servico,'tap'))[2])
         || ': a 1ª vence 2 dias depois que o seu nome estiver limpo e as outras a cada 30 dias (PIX ou boleto)'
  end
$$;

create or replace function public.registrar_mensagem_entrada(p jsonb)
returns jsonb language plpgsql as $$
declare v_me boolean := coalesce((p->>'from_me')::boolean, false); r jsonb;
        v_tel text := regexp_replace(coalesce(p->>'telefone',''), '\D', '', 'g');
begin
  if public.eh_numero_equipe(p->>'telefone')
     and not exists (select 1 from public.leads l
                      where l.telefone = v_tel
                        and exists (select 1 from public.contratos ct where ct.lead_id = l.id)) then
    return jsonb_build_object('acao', 'ignorar', 'motivo', 'numero_da_equipe');
  end if;
  if v_me then p := p - 'push_name'; end if;
  r := public.registrar_mensagem_entrada_base(p);
  if v_me and r->>'motivo' = 'humano_respondeu' then
    update public.conversas c set assumida_manual = true, assumida_por = 'equipe (iniciou a conversa)', assumida_em = now()
     where c.id = (r->>'conversa_id')::uuid and not c.assumida_manual
       and not exists (select 1 from public.mensagens m where m.conversa_id = c.id and m.autor in ('lead','ia'));
  end if;
  -- cliente da base (venda passada): a IA não atende; a conversa vai para a equipe
  if not v_me and r->>'acao' = 'processar' and public.eh_cliente_base((r->>'lead_id')::uuid) then
    update public.conversas set assumida_manual = true, assumida_por = 'cliente da base', assumida_em = now(), modo = 'humano'
     where id = (r->>'conversa_id')::uuid and base_liberada_em is null;
    if found then
      perform public.criar_alerta('handoff', (r->>'conversa_id')::uuid,
        'Cliente da base mandou mensagem. A IA não responde clientes antigos: a conversa ficou com a equipe.');
      r := r || jsonb_build_object('acao', 'humano', 'motivo', 'cliente_da_base');
    end if;
  end if;
  return r;
end $$;

-- rotina: só devolve sozinha quando o retorno automático estiver ligado
create or replace function public.retomar_conversas()
returns setof jsonb language plpgsql as $$
declare c public.conversas; v_lote jsonb; v_ult bigint;
begin
  if public.sdr_pausado() then return; end if;

  if public.ia_retorno_automatico() then
    for c in select * from public.conversas
              where modo = 'humano' and not assumida_manual and not aguardando_humano
                and humano_ultima_atividade_em <= now() - make_interval(mins => public.minutos_retorno_humano())
              for update skip locked loop
      update public.conversas set modo = 'ia' where id = c.id;
      insert into public.auditoria (acao, detalhe, por)
      values ('ia_retomou', jsonb_build_object('conversa_id', c.id, 'apos_minutos', public.minutos_retorno_humano()), 'sistema');
    end loop;
  end if;

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


-- ---------------------------------------------------------------------
-- Base de conhecimento: respostas aprovadas no manual da Ava
-- ---------------------------------------------------------------------
update public.kb set ativo = false
 where pergunta in ('Em quanto tempo o nome fica limpo?', 'Em quanto tempo o nome fica limpo? (prazo)', 'O que é o Limpa Nome?');

do $kb$
declare r record;
begin
  for r in select * from (values
    ('limpa_nome', 'Como funciona o Limpa Nome? É legal?',
     'O Limpa Nome é um processo judicial, baseado no Código de Defesa do Consumidor (Lei 8.078), no qual é emitida uma liminar para retirar todas as restrições dos órgãos de proteção ao crédito: Serasa, SPC e Boa Vista. O prazo oficial que pedimos é de 30 a 45 dias úteis, mas com o nosso acompanhamento e o empenho das nossas líderes costumamos entregar bem antes disso. Você recebe o contrato e um link para acompanhar o processo em tempo real.',
     'como funciona limpa nome o que é processo judicial liminar legal explica explique melhor nao entendi serasa spc boa vista'),
    ('limpa_nome', 'Qual o prazo do Limpa Nome? Em quanto tempo o nome fica limpo?',
     'O prazo oficial que pedimos é de 30 a 45 dias úteis. Com o nosso acompanhamento e o empenho das nossas líderes, costumamos entregar bem antes disso. Não prometa uma data exata de decisão do juiz.',
     'prazo tempo demora quantos dias quando fica limpo rapido'),
    ('limpa_nome', 'Vocês fazem limpa Bacen?',
     'Não trabalhamos com a limpeza de restrições no BACEN. Nosso trabalho é focado exclusivamente nos órgãos de proteção ao crédito tradicionais: SPC, Serasa e Boa Vista.',
     'bacen registrato scr banco central limpa bacen'),
    ('diagnostico', 'O que é o Diagnóstico de crédito?',
     'O diagnóstico é uma consulta completa em que levantamos todas as informações do seu perfil: capacidade de pagamento, renda, comprometimento de renda, qual é o seu rating, a média de score em todos os birôs de crédito, além de tudo o que tem de apontamento no seu CPF, como dívidas e protestos. Fazemos isso para ter um alinhamento completo do seu perfil e saber exatamente o que precisamos trabalhar no seu caso. Custa R$ 67,00 e é feito depois do pagamento.',
     'diagnostico diagnóstico o que vem relatorio consulta completa perfil score rating renda'),
    ('diagnostico', 'Como faço para começar? Quanto custa?',
     'Para começarmos da forma certa: você já tem conhecimento de todas as restrições no seu CPF ou prefere que a gente faça um diagnóstico completo para você conhecer detalhadamente todas as restrições e os valores? Esse diagnóstico completo custa R$ 67,00.',
     'como começo comecar começar quanto custa primeiro passo iniciar'),
    ('empresa', 'Qual é o seu nome? Com quem estou falando?',
     'Eu sou a Ava, consultora da Advance Consultoria. Estou aqui para te ajudar no que você precisar!',
     'nome seu nome quem fala com quem estou falando quem é voce'),
    ('rating', 'O que é o Rating? O que é a atualização de Rating?',
     'O rating bancário é uma estratégia para otimizar a sua pontuação e o seu perfil perante as instituições financeiras, melhorando o seu relacionamento com os bancos e facilitando a liberação de crédito e empréstimos. É a nota interna que os bancos dão a cada cliente, de A a E: corrigimos os mais de 27 fatores que derrubam essa nota e entregamos um relatório de antes e depois, com um guia para os 45 dias seguintes.',
     'rating bancario bancário o que é nota banco perfil credito emprestimo'),
    ('objecao', 'Qual é o tempo de garantia do nome limpo?',
     'Não. Por se tratar de uma liminar, não podemos dar garantia sobre o tempo. O que garantimos é que você vai ter o seu nome limpo, com todas as restrições e apontamentos retirados dos órgãos de proteção ao crédito. O tempo que a liminar e o nome limpo vão durar não conseguimos informar: temos liminares durando muito tempo, depende de qual liminar foi concedida.',
     'garantia quanto tempo fica limpo dura volta sujar liminar cai tempo de garantia'),
    ('objecao', 'É golpe? Empresa é confiável?',
     'Eu entendo perfeitamente a sua preocupação, é a de muitos clientes que chegam até nós. A Advance Consultoria é uma empresa respeitada, que atua no mercado há mais de cinco anos com limpa nome, rating e outros serviços. Você pode nos acompanhar no Instagram @advanceconsultoriaoficial. Somos de Aracaju, Sergipe, e atendemos o Brasil todo. Se quiser, podemos marcar uma ligação ou reunião para você nos conhecer melhor.',
     'golpe confiavel confiável seguro fraude medo ja cai em golpe verdade é real'),
    ('limpa_nome', 'Passo a passo e dados para contratar o Limpa Nome',
     'O processo é simples e 100% transparente. Para formularmos o seu contrato de prestação de serviços, precisamos apenas dos seus dados básicos: nome completo, CPF, endereço completo, telefone de contato e e-mail. Após o envio das informações e o pagamento, você recebe o contrato assinado para sua segurança e um link exclusivo para acompanhar o status do seu processo em tempo real. Nossa equipe continua disponível todos os dias para te passar qualquer novidade.',
     'contratar contratação dados precisa o que precisam documentos passo a passo como faço para contratar'),
    ('limpa_nome', 'Como funciona o pagamento via TAP?',
     'Na opção via TAP funciona assim: enviamos o valor da taxa de adesão (TAP, entrada de R$ 297,00), o contrato formalizado e o link de pagamento inicial. Damos entrada no seu processo e acompanhamos até a baixa das restrições. O pagamento do serviço só começa depois: a primeira parcela, de R$ 150,00, vence 2 dias após o seu nome estar efetivamente limpo, e as demais a cada 30 dias.',
     'tap taxa adesao adesão entrada 297 parcelas 150 como funciona'),
    ('pagamento', 'O parcelamento é no cartão de crédito?',
     'Não. O parcelamento é feito por boleto bancário (com PIX), emitido com toda a segurança pela nossa plataforma de pagamentos, o Asaas.',
     'cartao cartão credito crédito parcelamento parcelar no cartao boleto asaas')
  ) v(categoria, pergunta, resposta, palavras) loop
    update public.kb set resposta = r.resposta, palavras = r.palavras, categoria = r.categoria, ativo = true where pergunta = r.pergunta;
    if not found then
      insert into public.kb (categoria, pergunta, resposta, palavras) values (r.categoria, r.pergunta, r.resposta, r.palavras);
    end if;
  end loop;
end $kb$;

update public.kb set resposta = 'O valor de tabela do Limpa Nome é R$ 797,00. Hoje são três opções, só por PIX ou boleto: à vista R$ 597,00; 2x de R$ 400,00 (a 1ª na contratação e a 2ª vence 2 dias depois do nome limpo); ou via TAP: entrada de R$ 297,00 + 5x de R$ 150,00, a 1ª vencendo 2 dias depois do nome limpo e as demais a cada 30 dias. Use o texto oficial de valores do prompt.'
 where pergunta = 'Quanto custa o Limpa Nome?';
update public.kb set resposta = 'São 2x de R$ 400,00. A 1ª é paga na contratação e a 2ª vence apenas 2 dias depois que o seu nome estiver limpo. Total R$ 800,00.'
 where pergunta = 'Como funciona o pagamento em 2x do Limpa Nome?';
