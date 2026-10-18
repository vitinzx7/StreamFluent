# Níveis CEFR das palavras: fontes e licença

`src/data/word-levels.en.json` dá um nível (A1–C2) a cerca de 9.700 palavras inglesas isoladas. O lilás das legendas usa essa lista: uma palavra fica lilás quando o nível dela está acima do nível escolhido pelo usuário. Nada é consultado durante a reprodução; a lista vem dentro da extensão.

## Fontes

Ambas foram obtidas do repositório [Open Language Profiles — olp-en-cefrj](https://github.com/openlanguageprofiles/olp-en-cefrj) em 18/10/2026:

| Arquivo | Níveis | Verbetes | Autoria | Termos |
|---|---|---|---|---|
| `cefrj-vocabulary-profile-1.5.csv` | A1–B2 | 7.799 | CEFR-J Wordlist Ver1.5 — Tono Laboratory, Tokyo University of Foreign Studies | Uso livre para pesquisa e fins comerciais, desde que a fonte seja citada. |
| `octanove-vocabulary-profile-c1c2-1.0.csv` | C1–C2 | 2.136 | Octanove Vocabulary Profile C1/C2 1.0 — Octanove Labs | Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). |

Como a parte C1/C2 é CC BY-SA 4.0, **a lista derivada `word-levels.en.json` também é distribuída sob CC BY-SA 4.0**. A atribuição aparece nesta nota, nos metadados do JSON, no README e no rodapé da página de boas-vindas da extensão. A licença vale para os dados, não para o código da extensão.

## Como a lista é derivada

`node scripts/build-word-levels.mjs <cefrj.csv> <octanove.csv>` gera o JSON:

- Mantém só palavras isoladas: 157 expressões de várias palavras ("according to", "bank account") ficam de fora, porque a legenda colore uma palavra por vez. Outros 11 verbetes com caracteres fora de letras, apóstrofo e hífen ("a.m.", "MP3 player") também.
- Variantes separadas por barra ("analyze/analyse") viram entradas separadas, com o mesmo nível.
- Cada palavra fica no **menor** nível listado para a mesma classe gramatical.

As listas trazem só a forma base. As flexões que aparecem nas legendas são geradas em `src/core/word-levels.ts`, ao carregar: plural, `-s`/`-ed`/`-ing`, comparativo e superlativo por regras regulares, mais tabelas explícitas de verbos, plurais e adjetivos irregulares ("went", "children", "better"). Cada forma fica com o menor nível pelo qual é alcançada: "found" é A1 (passado de *find*), embora *found* ("fundar") seja C1. A regra erra para menos lilás, nunca para mais.

## Regras do lilás

- Só legendas em inglês. Português não recebe lilás.
- Palavra acima do nível do usuário → lilás. No nível ou abaixo → cor normal/azul.
- Palavras fora da lista (nomes, gírias, palavras raras não listadas) nunca ficam lilás.
- As 100 palavras especiais (ver [special-words-sources.md](special-words-sources.md)) que já estão na lista CEFR mantêm o nível dela; as outras 67 contam como **acima de C2**, então são as únicas que um usuário C2 ainda vê em lilás.
- Enquanto o usuário não escolhe um nível, o lilás continua sendo exatamente a lista fixa de 100 palavras.
- A marca pessoal (difícil/aprendida) sempre vence o lilás.

## Limitações

- A classe gramatical da palavra na legenda é desconhecida; por isso vale o menor nível entre homógrafos.
- Flexões geradas por regra podem incluir formas que não existem; elas nunca aparecem em legendas e não afetam nada.
- A lista não cobre todo o vocabulário avançado. Palavras raras fora dela não ficam lilás nem para níveis baixos.
