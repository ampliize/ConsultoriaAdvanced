-- Localização, Instagram e agenda do Google da Advance.

insert into public.kb (categoria, pergunta, resposta, palavras)
select v.categoria, v.pergunta, v.resposta, v.palavras
  from (values
    ('empresa', 'Onde fica a Advance? De onde vocês são?',
     'A sede da Advance Consultoria fica em Aracaju, Sergipe, no Urquiza Leal Mall, nº 901, Sala 9.',
     'endereço endereco localização localizacao onde fica sede escritório escritorio cidade aracaju sergipe de onde são'),
    ('empresa', 'Vocês têm Instagram? Como acompanho o trabalho de vocês?',
     'Pode nos seguir no Instagram: @advanceconsultoriaoficial. Lá a gente mostra o nosso trabalho e os resultados dos clientes.',
     'instagram insta redes sociais rede social perfil acompanhar seguir página pagina')
  ) as v(categoria, pergunta, resposta, palavras)
 where not exists (select 1 from public.kb k where k.pergunta = v.pergunta);

update public.config set valor = '"advanceconsultoriase@gmail.com"'::jsonb
 where chave = 'google_calendar_id';
