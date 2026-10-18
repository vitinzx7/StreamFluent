# StreamFluent

Extensão Chrome Manifest V3 para estudar idiomas com legendas. Netflix e Max usam as legendas já renderizadas no DOM. O modo HTML5, habilitado para Cinetaro e seu player incorporado `cinextream.cc`, lê faixas acessíveis ou um arquivo SRT/VTT local e usa o tempo real do vídeo. Os dois caminhos oferecem as mesmas ferramentas de estudo: palavras clicáveis e coloridas, cartão de consulta, atalhos, pausa automática e salvamento da fala.

**Situação:** implementado, com testes automatizados e execuções em Chrome headless da página de teste da extensão, de uma página local com forma de Netflix e da biblioteca (detalhes em [docs/study-controls-progress.md](docs/study-controls-progress.md)). O usuário usou a versão anterior na **Netflix real** e relatou que tudo funcionou, exceto a tradução da fala atrasada, o botão em cima do de tela cheia e a camada em tela cheia; essas três correções e os níveis ainda não foram vistos na Netflix real. Max e Cinetaro não foram verificados em player real. Não há transcrição de áudio nem recuperação automática de falas ausentes. O que ainda está planejado: [docs/proximos-passos.md](docs/proximos-passos.md).

## Instalar e recarregar

```bash
npm install
npm run typecheck
npm test
npm run build
```

1. Abra `chrome://extensions`, ative o modo de desenvolvedor e carregue a pasta `dist/` em **Carregar sem compactação**.
2. Se já estiver instalada, clique em **Recarregar** na extensão depois do build.
3. Recarregue também a aba do streaming para substituir o content script antigo. Se o navegador solicitar o novo acesso a `cinextream.cc`, conceda esse domínio para conectar o player incorporado.

Na primeira instalação abre uma página que pergunta o seu nível de inglês (A1 a C2). Em quem atualizou, o player pergunta na primeira legenda em inglês; dá para mudar depois no popup ou no painel.

`npm run watch` recompila os bundles; alterações em `public/` exigem um novo build. Não há comando de lint.

## Estudar com as legendas

### Mouse e cores

| Ação | Resultado |
|---|---|
| Clique esquerdo numa palavra | Abre um cartão pequeno logo acima da palavra, com tradução, definição (inglês, quando a API tiver) e os botões **Difícil**, **Aprendida** e **Salvar** (palavra + frase). Clicar de novo na marcação ativa a remove. Marcar e salvar funcionam mesmo sem tradução. |
| Clique direito numa palavra | Marca como **difícil** na hora, sem abrir o cartão, sem tradução e sem internet. Fora das palavras o menu normal do navegador continua. |

| Cor | Significado |
|---|---|
| Branco | Palavra já vista, sem outra regra. |
| Azul claro | Primeira vez que a palavra aparece no seu histórico daquele idioma (opção "Destacar palavras novas", ligada por padrão). |
| Vermelho | Marcada como difícil por você. |
| Verde | Marcada como aprendida por você. A antiga marca amarela foi convertida em aprendida. |
| Lilás | Palavra em inglês **acima do seu nível** (opção "Destacar palavras acima do meu nível"; liga ao escolher o nível). |

Sua marca sempre vence; depois vêm lilás, nova e normal. Remover a marca volta à cor automática.

**Níveis.** O lilás usa uma lista de cerca de 9.700 palavras inglesas com nível CEFR, montada a partir da CEFR-J Wordlist (A1–B2) e do Octanove Vocabulary Profile (C1–C2); a extensão reconhece também as flexões ("went" conta como "go"). Quanto mais baixo o seu nível, mais palavras ficam lilás: em A1 quase todo vocabulário além do básico; em C2 só as raras. Nomes e palavras fora da lista nunca ficam lilás, e legendas em português também não. Enquanto você não escolhe um nível, o lilás continua sendo a lista fixa de 100 palavras especiais ([procedência](docs/special-words-sources.md)); com nível escolhido, as 67 delas que não estão na lista CEFR contam como "acima de C2". Fontes e licença (CC BY-SA 4.0): [docs/word-levels-sources.md](docs/word-levels-sources.md). Desenhos infantis têm poucas palavras acima de B1 — é normal ver pouco lilás neles.

### Atalhos

| Tecla | Ação |
|---|---|
| `A` | Fala anterior. No silêncio logo depois de uma fala, repete essa fala. Não salta trechos que você pulou. |
| `S` | Repetir fala: volta ao começo da fala estudada e reproduz uma vez. |
| `D` | Avançar 5 s (não procura a próxima legenda). Pressões rápidas somam. |
| `Espaço` | Reproduzir / pausar. |
| `Q` | Ligar/desligar a pausa automática. |
| `R` | Salvar a fala original completa, sem precisar escolher palavra e sem esperar tradução. |
| `Ctrl+C` / `⌘C` | Copiar a fala original completa, quando não há texto selecionado. Com seleção, a cópia normal continua. |

Os atalhos não agem enquanto você digita num campo, nem em Espaço/Enter sobre um botão focado. Na Netflix/Max eles só começam depois que o episódio mostrou uma legenda, e o Espaço continua com a Netflix até o player dela confirmar que aceita play/pause. No HTML5 eles valem com a camada ativa e o foco no documento do player. "Copiar fala" e "Salvar fala" também estão no painel.

### Painel e tela cheia

O botão do painel (**Aa** na Netflix/Max, **SF · Legendas** no HTML5) fica na **borda direita, no meio da tela**, longe da barra de controles do player, e some quando o mouse fica parado — mexa o mouse para ele voltar. Os avisos aparecem no topo, no centro. Na tela cheia da Netflix (botão ou tecla F) a legenda, o cartão e o painel continuam aparecendo, e clicar neles não pausa nem tira o vídeo da tela cheia.

### Pausa automática

Ligada por `Q` ou pelo painel/popup (começa desligada e a escolha fica salva). O vídeo pausa no fim de cada fala e ela continua na tela para consulta, `R` e cópia. Retomar não pausa de novo na mesma fala; `S` a repete e ela pode pausar outra vez. `A`, `D` ou uma busca liberam a fala retida. Desligar com `Q` enquanto pausado não dá play.

- **HTML5:** pausa pelo relógio do vídeo no fim da fala, já com o ajuste aplicado; falas sobrepostas pausam uma vez no fim do grupo.
- **Netflix/Max:** as legendas do DOM não trazem tempos, então a pausa é **aproximada** — acontece quando a fala some ou é trocada na tela, pouco depois do fim real (cerca de 0,1 s na execução local). Duas falas idênticas seguidas, sem mudança no DOM, contam como uma.

### Cartão de palavra

Além da tradução e da definição, o cartão tem, no rodapé, **Linguee · WordReference · Reverso · Cambridge**, que abrem a palavra nesses dicionários numa aba nova. O Linguee e o Reverso mostram a palavra em frases reais traduzidas, o que ajuda quando a tradução de uma palavra solta fica literal demais. A palavra só vai para esses sites se você clicar.

### Biblioteca e seus dados

Abra pelo popup ou pelo painel. Três vistas: **Frases salvas** (por `R` e pelo cartão), **Palavras difíceis** e **Palavras aprendidas**, com busca, filtro de idioma e de plataforma. "Palavras difíceis" abre direto por `library.html?tab=difficult`. Mudar de difícil para aprendida, remover marca ou apagar frases não afeta o resto; "Apagar todas as frases" não apaga marcas nem preferências.

Em **Seus dados**, no fim da biblioteca:

- **Exportar backup** baixa um arquivo `.json` com palavras vistas, marcações, frases e preferências (inclusive o nível).
- **Importar backup** junta o arquivo ao que já existe: une o histórico, mantém a marcação mais recente de cada palavra, ignora frases repetidas e restaura as preferências.
- **Apagar histórico de palavras vistas** faz tudo voltar a ser "novo" (azul), mantendo marcações e frases.
- **Apagar todos os dados de estudo** apaga palavras vistas, marcações e frases, mantendo nível e preferências.

Desinstalar a extensão apaga os dados deste navegador: exporte um backup antes.

## Usar no Cinetaro / HTML5

Abra `https://cinetaro.to/watch/62560?ep=8` e inicie o player. A extensão executa dentro do frame `cinextream.cc`, mantendo apenas um painel ativo. O topo transmite a troca de episódio por mensagens internas validadas, sem enviar a URL para os tradutores. No painel StreamFluent:

1. Selecione uma faixa acessível ou importe um arquivo `.srt`/`.vtt` em UTF-8, até 2 MB. Informe se o arquivo já está em português ou se está em inglês.
2. Ative a camada de legendas. A importação fica apenas em memória, sem upload do arquivo.
3. Ative a tradução para português brasileiro se quiser enviar a fala atual ao tradutor. O texto original continua disponível enquanto a tradução está pendente ou falha. Clicar numa palavra consulta só aquela palavra, sem ligar a tradução das falas.
4. Use **Adiantar 0,5 s** quando a legenda aparece depois da fala; use **Atrasar 0,5 s** quando aparece antes. **Restaurar** volta a zero.

Exemplo: uma fala marcada em 10–12 s aparece em 9,5–11,5 s após adiantar e em 10,5–12,5 s após atrasar. O intervalo é fechado no início e aberto no fim. Pausa, busca e velocidade usam `video.currentTime`, sem acumular um relógio separado.

Trocar episódio, fonte de mídia ou elemento de vídeo descarta a faixa importada e o ajuste. Respostas de tradução antigas não podem substituir as da nova sessão. Selecionar uma nova faixa também restaura o ajuste.

Um deslocamento fixo não resolve descompasso crescente ou legendas de outra edição. Falas ausentes precisam de uma faixa mais completa: tradução não cria texto ausente.

## Netflix e Max

Habilite as legendas no site. A camada StreamFluent substitui as legendas do player, com as palavras clicáveis e a tradução da fala por baixo. O botão **Aa** abre o painel, em três abas: **Ajustes** (tradução da fala, idioma, nível, pausa automática, copiar/salvar fala e biblioteca), **Cores** (o que cada cor quer dizer, com as chaves para ligar o azul e o lilás) e **Teclas** (o mapa das teclas e do mouse). Arraste a legenda para mudar a posição. A biblioteca abre pelo service worker.

Na Netflix, saltos e play/pause passam pela API do próprio player (não documentada), nunca por `video.currentTime`, que quebra o player dela (M7375). Se essa API mudar, os saltos falham sem afetar a reprodução e o Espaço volta para a Netflix. Na Max, os comandos usam o elemento de vídeo diretamente (não verificado no site real).

## Player de teste local

No popup, clique em **Testar player local**. A página contém um vídeo sintético de 15 segundos, sem downloads externos, e uma faixa de exemplo; os arquivos de importação estão em `public/fixtures/`. As instruções da página cobrem tempo, ajuste, tela cheia, palavras, atalhos e pausa automática.

Esta página foi executada com a extensão carregada num Chrome headless isolado e rede externa bloqueada: palavras e cores, cliques, D/S/Espaço/R/Ctrl+C/Q e pausa automática passaram. Ainda vale repetir à mão, num Chrome normal:

- Ativar a tradução da fala e conferir texto, acentos e o tempo até ela aparecer (precisa de rede).
- Importar `example.srt` e `example.vtt`; conferir múltiplas linhas e intervalos.
- Mudar para 2x; trocar episódio e substituir vídeo durante uma tradução.
- Entrar/sair da tela cheia do contêiner; conferir painel, legenda e ausência de duplicatas.
- Repetir na Netflix/Max com conteúdo real — inclusive se a Netflix/Max reagem às mesmas teclas, a tela cheia, a pergunta de nível e o botão na borda direita — e no Cinetaro.

Os testes automatizados usam DOM e respostas controladas: **546 testes em 36 arquivos** passaram, assim como `npm run typecheck`, `npm run build` e `git diff --check`. Eles não comprovam a API real da Netflix, CORS, políticas de fullscreen ou a estrutura atual dos sites.

## Privacidade e rede

- Sem download de streaming, contorno de DRM, telemetria ou análise de áudio.
- As únicas APIs externas são `clients5.google.com` e `api.mymemory.translated.net` para tradução, e `api.dictionaryapi.dev` para definições em inglês.
- Saem somente a fala atual e, no fluxo de consulta, a palavra selecionada. Título, episódio, biblioteca, vocabulário e arquivo completo não são enviados. O clique direito não usa a rede.
- Os links de dicionário do cartão (Linguee, WordReference, Reverso, Cambridge) só abrem se você clicar; a extensão nunca acessa esses sites sozinha.
- As listas de palavras especiais e de níveis vêm empacotadas; os links Linglify/Oxford/Open Language Profiles são só procedência, nunca acessados pela extensão.
- Tradução no modo HTML5 exige ativação visível. Não há tradução antecipada ou em lote, nem tradução disparada por `R`.
- O worker valida destinos, usa timeout por provedor e não envia cookies nem segue redirecionamentos.
- Frases, marcas e preferências ficam em `chrome.storage.local`; o histórico de palavras vistas fica no IndexedDB da extensão. Tudo é gravado por um único serviço no worker e nada é sincronizado. A permissão `unlimitedStorage` (sem aviso na instalação) tira o limite de 10 MB e impede que o Chrome descarte o IndexedDB por falta de espaço. Copiar usa só escrita no clipboard (sem permissão de leitura).
- Não há chaves ou assinatura nova. O endpoint Google é não documentado e pode recusar chamadas ou mudar. MyMemory possui limites próprios. Nenhum deles tem disponibilidade ou uso ilimitado garantido.

## Limitações

- Apenas vídeos e faixas que o navegador permite ler. Legendas em imagem, áudio sem faixa e formatos diferentes de SRT/VTT não são suportados.
- O domínio `cinextream.cc` foi identificado pelo diagnóstico do usuário e recebeu uma entrada específica no manifesto. Outros hosts continuam sem suporte. O aviso lista as origens declaradas dos frames; `iframe.src` pode diferir da origem final após redirecionamento. Enquanto o vídeo estiver inacessível, a importação fica desativada por falta de relógio para sincronizar.
- Tela cheia do contêiner (a da Netflix) hospeda a camada. Na tela cheia nativa do próprio elemento de vídeo a camada não aparece: as legendas originais voltam e pausa automática, `R` e cópia ficam suspensas.
- O nível vale só para legendas em inglês. A lista não cobre todo o vocabulário avançado: palavras raras fora dela não ficam lilás.
- A tradução da fala ainda depende de serviços gratuitos (Google não documentado, MyMemory com cota pequena); o atraso diminuiu, mas não some se os dois estiverem lentos.
- Atalhos num iframe só funcionam com o foco nesse frame.
- Na Netflix/Max a pausa automática é aproximada; uma fala que continua na tela através de uma busca não pausa no próprio fim.
- Os seletores DOM e a API de player da Netflix/Max continuam sujeitos a mudanças dos sites.
- A detecção de episódio usa URL e fonte do vídeo. Players que trocam conteúdo mantendo ambos exigem integração específica.

## Código

- `src/adapters/netflix.ts`, `max.ts`: extração DOM e comandos de player por plataforma.
- `src/core/netflix-bridge.ts`, `src/content/netflix-main.ts`: ponte fechada (seek/play/pause/probe) para a API do player da Netflix no mundo da página.
- `src/adapters/html5-player.ts`, `src/core/player-types.ts`: descoberta de vídeo, frames acessíveis, eventos e sessões.
- `src/core/subtitles.ts`: parsing, UTF-8, intervalos, ajuste, ocorrências e controle assíncrono.
- `src/core/ui/subtitle-overlay.ts`, `ui/timed-subtitles.ts`: camadas Netflix/Max e HTML5; `ui/word-renderer.ts`, `ui/word-card.ts`: palavras e cartão compartilhados.
- `src/core/word-actions.ts`, `study-actions.ts`, `keyboard-shortcuts.ts`: cliques, comandos e o roteador de teclado.
- `src/core/study-context.ts`, `playback-controller.ts`, `line-navigation.ts`, `line-timeline.ts`, `auto-pause.ts`: fala de estudo, comandos de reprodução, fala anterior e pausa automática.
- `src/core/vocabulary.ts`, `word-status.ts`, `word-normalization.ts`, `special-words.ts`, `src/data/special-words.en.json`: histórico, marcas, cores e lista especial.
- `src/core/cefr.ts`, `word-levels.ts`, `src/data/word-levels.en.json`, `scripts/build-word-levels.mjs`: níveis CEFR, flexões e o gerador da lista.
- `src/core/study-storage.ts`, `seen-store.ts`, `study-data.ts`, `study-messages.ts`, `storage.ts`, `settings.ts`: persistência serializada no worker (histórico no IndexedDB), migração, backup e clientes.
- `src/core/ui/idle-fade.ts`: botão que some com o mouse parado e isolamento dos cliques em relação ao player.
- `src/core/translation.ts`, `translation-request.ts`: tradutor reutilizado e transporte restrito.
- `src/background/background.ts`: worker (persistência de estudo, provedores, biblioteca e relay dos frames).
- `src/content/content.ts`: integração Netflix/Max e ciclo de vida.
- `src/content/cinetaro-session.ts`, `src/core/frame-messages.ts`: coordenação dos frames, sessão do episódio e validação das mensagens.
- `src/__tests__/`: testes unitários e de integração.

`public/popup.js`, `library.js`, `welcome.js` e `study-client.js` são JavaScript sem compilação TypeScript; mudanças de protocolo, schema, níveis ou detecção precisam manter as cópias coerentes.
