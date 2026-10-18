# Palavras especiais: conjunto e procedência

O conjunto abaixo contém **100 palavras selecionadas das tabelas do artigo indicado pelo usuário**, com verbetes confirmados individualmente no **Oxford Advanced Learner’s Dictionary**. Não é um ranking oficial das “100 mais difíceis”. A seleção reúne vocabulário acadêmico, literário, técnico e formas difíceis do artigo.

Fontes consultadas:

- [Linglify — palavras difíceis em inglês](https://linglify.com/pt-BR/learn/en/blog/hard-english-words): origem dos candidatos.
- [Oxford Learner’s Dictionaries](https://www.oxfordlearnersdictionaries.com/): confirmação lexical pelos 100 links individuais abaixo.
- [Oxford 3000 e 5000 — explicação das listas](https://www.oxfordlearnersdictionaries.com/about/wordlists/oxford3000-5000).
- [The Oxford 5000 — PDF oficial das 2.000 entradas adicionais](https://www.oxfordlearnersdictionaries.com/external/pdf/wordlists/oxford-3000-5000/The_Oxford_5000.pdf).

**“Existe na Oxford” e “pertence à Oxford 5000” não são a mesma afirmação.** Todas as 100 foram confirmadas no dicionário; 25 também foram encontradas no PDF das entradas adicionais da Oxford 5000 e recebem metadados de nível/página abaixo. Ausência desse campo nas outras 75 significa apenas que este arquivo não lhes atribui essa confirmação adicional ou nível CEFR. Não significa ausência no dicionário, nem autoriza inferir C1/C2.

A dificuldade não é calculada em execução. O produto chama o recurso de “Palavras especiais” e utiliza este conjunto fixo quando o usuário liga o botão. Não reproduzir definições, exemplos ou pronúncias das fontes no dataset: os links servem à procedência e o cartão mantém os provedores já existentes.

O JSON é o payload canônico a extrair para `src/data/special-words.en.json`. `oxford5000Additional` é metadado documental, sem efeito na cor e sem interface de níveis. A ordenação é alfabética, não por dificuldade. Não substituir palavras para completar a contagem: ela já está fechada e verificada.


Os metadados fornecidos pela especificação foram preservados em `src/data/special-words.en.json`. Esta implementação não refez a verificação editorial dos verbetes. Não há consultas às fontes durante build ou reprodução.
