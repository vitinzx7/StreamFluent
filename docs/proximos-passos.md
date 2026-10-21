# Próximos passos

O que foi conversado e ficou de fora da rodada atual, em ordem sugerida. Nada aqui está implementado.

## 1. Verificar na Netflix real o que mudou nesta rodada

O usuário testa sempre na Netflix. Antes de qualquer item novo, conferir no player real:

- a pergunta de nível na primeira legenda e a página de boas-vindas na instalação;
- o lilás por nível num episódio com vocabulário variado (desenhos infantis têm poucas palavras acima de B1);
- o botão na borda direita, sem cobrir o botão de tela cheia, e sumindo com o mouse parado;
- a camada, o cartão e o painel na tela cheia da Netflix, e que clicar neles não pausa nem sai da tela cheia;
- o tempo até a fala traduzida aparecer;
- exportar, apagar e importar um backup.

## 2. Contas e sincronização — feita como conta opcional (Supabase)

Implementada por outra sessão e juntada a esta rodada em 21/10/2026: [plano](account-sync-plan.md), [estado e checklist do Supabase](CONTINUAR-AQUI.md#conta-opcional-supabase). Difere do que foi conversado aqui: o histórico de palavras vistas **não** é enviado (fica no dispositivo) e conflitos não usam "a mais recente vence": edições diferentes do mesmo item pedem escolha explícita. O que ainda falta:

- Validar num Chrome real: cadastro, e-mail de confirmação, sincronização entre dois perfis, conflitos e alarmes (lista em [progresso](study-controls-progress.md)).
- SMTP próprio no Supabase antes de amigos criarem conta.
- Aviso de privacidade (LGPD) e opção de apagar a conta e os dados da nuvem; hoje sair ou desinstalar não apaga nada no servidor.
- Login com Google; trocar de conta no mesmo perfil Chrome.

## 3. Tradução de palavra no contexto (precisa de servidor)

O cartão traduz a palavra solta, por isso fica literal. Duas opções, ambas com a chave de API guardada no servidor (nunca dentro da extensão):

- **API de dicionário**, como o Dictionary Lookup do Azure Translator: várias traduções por classe gramatical e frases de exemplo.
- **IA**: palavra + frase → significado naquele contexto, explicação curta e outros sentidos. Limite por usuário e cache por (palavra, frase).

Ambas enviam a palavra e a fala a um novo provedor; precisam ser recurso explícito e documentado.

## 4. Tradução da fala ainda mais rápida

Já feito: as duas linhas aparecem juntas (a original espera a tradução, até 1 s) e as traduções ficam guardadas, então uma fala já vista aparece na hora. Falta a primeira vez de cada fala, que espera o tradutor (≈0,3–0,6 s medidos daqui).

- Na Netflix, a extensão só conhece a fala que está na tela. Para traduzir antes, seria preciso ler o arquivo de legendas que o próprio player baixa (sem DRM; é o que extensões como o Language Reactor fazem). **Muda duas regras do projeto**: deixa de ler só o DOM e envia ao tradutor falas ainda não exibidas. Exige decisão explícita e documentação.
- No HTML5 (tempos conhecidos), traduzir a próxima fala antes de ela aparecer. **Muda o que sai da máquina** (uma fala ainda não exibida): exige decisão explícita e documentação.
- Um tradutor oficial (Azure Translator, DeepL) pelo servidor do item 2 seria mais rápido e estável que o endpoint não documentado do Google.

## 5. Níveis: próximos refinamentos

- Teste de nivelamento curto, para quem não sabe o próprio nível.
- Níveis para legendas em português (precisa de uma lista graduada de português com licença compatível).
- Cobrir palavras raras fora da lista CEFR, por exemplo por frequência em legendas (SUBTLEX), conferindo a licença.
- Adaptar mais coisas ao nível (por exemplo, a tradução da fala ligada por padrão em A1–A2), se fizer sentido para o usuário.

## 6. Espanhol

A extensão hoje só trabalha com inglês ↔ português. Espanhol exige direção nova, tradutores, dicionário e lista de níveis próprios.
