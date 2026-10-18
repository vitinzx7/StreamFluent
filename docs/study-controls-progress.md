# Implementação dos controles de estudo

Base: `8dd950512dab8b6439e4391b8064bb060632a72d`. Branch: `feat/study-controls-vocabulary`.

Antes da implementação: checkout limpo; typecheck e build aprovados; 298 testes em 21 arquivos aprovados (Node 24.19.0, npm 11.9.0).

## Blocos

1. Concluído: schema V2, migração idempotente, fila de persistência no worker e clientes. Verificados migração/falhas/reinício/concorrência, settings, vocabulário, protocolo de páginas públicas, integração content/overlay e boundaries de background/frames. Typecheck e build aprovados. As chaves de estudo só são gravadas pelo serviço central.

Os resultados de players reais serão registrados separadamente dos testes controlados. A especificação original previa commits locais. Em seguida, o usuário pediu explicitamente um checkpoint no GitHub com o trabalho atual e um plano para outra IA continuar. Este envio preserva a branch de trabalho; não faz merge nem publica a extensão.

2. Concluído: lista canônica de 100 palavras, fontes locais, resolvedor de prioridade pessoal/especial/nova, controles de especiais e cores aprendidas. 84 testes direcionados passaram; typecheck/build aprovados. Commit anterior: `a46e7c2`.

3. Concluído: renderizador compartilhado sem perda de texto, clique direito offline, cartão persistente acessível com ações assíncronas e remoção explícita de marca. 53 testes de content/overlay aprovados; typecheck/build aprovados. Commit do bloco 2: `d733fd1`.

4. Concluído: biblioteca com frases/difíceis/aprendidas, busca/filtros, ações confirmadas, atualização entre páginas, deep links e renderização literal. 19 testes de biblioteca/storage/background aprovados; typecheck/build aprovados. Commit do bloco 3: `3b67053`.


5. Concluído (retomado do checkpoint WIP `c20091b` por outra sessão): controlador de reprodução revisado — `repeat` recusa snapshot de outra sessão, chamadas ao driver têm prazo (fila nunca fica pendurada), `toggle`/`pause` confirmam o novo estado no `<video>` antes da próxima pressão, alvo pendente vale para A/D/S em sequência. Ponte Netflix com ação fechada `probe` (verifica `play`/`pause` sem chamá-los); `NetflixAdapter.canPlayPause()` só fica verdadeiro após a resposta, então o Espaço continua com a Netflix até lá. Contexto de estudo com fala ao vivo/segurada/retida e conversão para frase `sentence`. Código do WIP reescrito no estilo do repositório. Typecheck, 360 testes em 27 arquivos e build aprovados. Ainda sem integração ao teclado (bloco 6).

6. Concluído: roteador central `keyboard-shortcuts.ts` (um listener em capture por janela do player; respeita `composedPath`, IME, campos editáveis inclusive em Shadow DOM, Espaço/Enter em controles focados, seleção nativa no Ctrl/⌘+C, modificadores, maiúsculas e repetição; também suprime keyup/keypress das teclas assumidas). `study-actions.ts` compartilha os handlers entre teclas e botões: R salva `kind: "sentence"` a partir do snapshot capturado no keydown, sem esperar tradução; cópia chama `navigator.clipboard.writeText` no mesmo gesto e, se recusada, mostra campo somente leitura selecionado; Q usa `toggle-auto-pause` no worker. `content.ts` passou a usar snapshots por ocorrência (sessão = caminho + `<video>`), e o listener legado do A foi removido de `line-navigation.ts` — os testes do A agora passam pelo roteador + controlador reais. Atalhos ficam inativos até a sessão mostrar uma legenda (prévias e menus mantêm suas teclas); Espaço só é assumido quando o player confirma play/pause. Painel com "Copiar fala"/"Salvar fala". Q já salva a preferência; a pausa em si é o bloco 7. Typecheck, 413 testes em 29 arquivos e build aprovados.

7. Concluído: `auto-pause.ts` com um pedido de pausa único (decisão registrada antes de aguardar o player; resposta antiga descartada após seek/sessão/idioma) e dois detectores. DOM (Netflix/Max): pausa aproximada quando a fala some ou é substituída, só para fala exibida desde o último salto, com vídeo em reprodução normal (não pausado, sem seek, sem buffering, fora da janela de 700 ms após um salto); a fala que terminou fica "segurada" enquanto a pausa está em voo e é retida só após confirmação; falha mostra aviso e volta à fala ao vivo. Temporal (pronto para o bloco 8): passagem por `fim + offset` no relógio do vídeo, grupos com sobreposição positiva pausam uma vez no maior fim, falas contíguas mantêm términos separados, saltos/offset iniciam nova passagem, passos grandes não contam como reprodução. Integrado a `content.ts`: palavras da fala oculta só são registradas quando exibida; play/seek/A/D/S liberam a retenção; desligar Q não dá play. Limitação registrada: duas falas DOM idênticas seguidas, sem mudança de DOM, não são distinguíveis; uma fala que continua na tela através de um seek não pausa no seu fim. Typecheck, 444 testes em 30 arquivos e build aprovados.

8. Concluído: a camada HTML5/Cinetaro (`ui/timed-subtitles.ts`) usa o mesmo renderizador de palavras, cartão, resolvedor de cores, contexto de estudo, controlador de reprodução (`createHtml5Driver`), roteador de atalhos, ações de estudo e pausa automática temporal, tudo dentro do Shadow DOM (estilos próprios; eventos só nas palavras, cartão e caixas). A consulta/marcação de palavra foi extraída para `word-actions.ts`, usado pelos dois caminhos. Idioma efetivo do seletor: inglês → `en`, português → `pt-BR` (sem especiais). A tradução da fala continua opt-in; clicar numa palavra consulta só a palavra. `TimedSubtitleView` ganhou ocorrência, índices e tempos de origem; a mesma faixa carregando mais falas mantém a ocorrência e uma pausa em voo. S usa o início real do cue + offset; A usa a timeline aprendida, como no Netflix/Max. O roteador é instalado na janela do documento do vídeo (frame same-origin incluído) só com a camada ativa, e removido ao desativar, em tela cheia nativa do vídeo (que também suspende pausa automática, R e cópia) e no `destroy` da troca de dono. `PlayerSnapshot` ganhou `seeking`. Fixture `player-test.html` com os novos passos manuais. Typecheck, 461 testes em 31 arquivos e build aprovados. Não validado em browser nesta etapa.

9. Concluído: `study-integration.test.ts` exercita os módulos reais juntos (overlay, vocabulário, preferências, frases, atalhos, pausa automática e o worker serializado; só adaptador e provedores são falsos): especial → difícil → aprendida → sem marca (C07), dois cliques direitos e nenhuma chamada de rede (M01/M02), cartão útil com tradução falha (M03), HTML como texto (S01), perfil antigo + primeira fala antes do storage (C02/C03), azul em todas as aparições da primeira fala e nunca mais (C04/C05), padrões de instalação (C01), duas abas + biblioteca aberta (P01/L01), pausa + R/cópia sobre a fala retida, Q serializado, troca de episódio com salvamento e consulta pendentes, hosts e permissões do manifesto (S02). Correções que esses testes e a execução em browser revelaram: verde de "Aprendida" no overlay era `#69db7c` (agora `#81C784`, como o spec); "Já está nas difíceis" agora vem do `changed` do worker (dois cliques rápidos mostravam "Adicionada" duas vezes); na pausa DOM, `seeked` desarmava a fala do destino quando chegava depois dela — agora só `seeking` é salto e `seeked` renova a tolerância; a timeline guarda o menor início visto de uma fala (vista primeiro no meio após um seek, A caía no meio dela). Typecheck, 476 testes em 32 arquivos e build aprovados.

### Execução em browser (18/10/2026)

Chrome 155.0.8059.84 headless, perfil temporário isolado, `dist/` carregado por `Extensions.loadUnpacked` (CDP via `--remote-debugging-pipe --enable-unsafe-extension-debugging`), todos os hosts externos sem resolução (`--host-resolver-rules`), entrada por eventos reais de teclado/mouse do CDP.

- `player-test.html` (fixture da extensão): **17/17**. Palavras clicáveis e azuis no Shadow DOM, faixa nativa oculta/restaurada, clique direito real → difícil persistido sem abrir cartão, clique esquerdo → cartão útil offline, "Aprendida" persistida, D +5 s pausado, S em 4,76 s (início 5 s − pré-roll, fim anterior 4 s) e play, Espaço alterna, R salva a fala com a quebra de linha, Ctrl+C escreveu no clipboard ("Copiado"), Q liga, pausa automática em 4,00 s com a fala retida, retomar não pausa de novo, próxima pausa em 8,00 s, camada desligada libera D.
- Página local **com forma de Netflix** (não é a Netflix): `www.netflix.com` mapeado para um servidor HTTPS local com legenda DOM nos seletores do adaptador e um `window.netflix` mínimo. Rodam o content script, o script MAIN e a ponte reais: **12/12**. Overlay e ocultação da legenda nativa, azul, clique direito persistido, A via API do player (0,86 s), Espaço só após o `probe`, D +5 s via ponte, Q, pausa DOM aproximada em 4,11 s (fala termina em 4,0 s; atraso do debounce) com a fala retida, R sobre ela, retomar sem nova pausa, próxima pausa em 8,11 s.
- **Não verificado em player real** Netflix, Max ou Cinetaro: API real da Netflix (play/pause/seek), ordem dos listeners de teclado da Netflix/Max, seletores atuais, CORS, iframe `cinextream.cc`.

10. Concluído: README (atalhos, cores, cliques, padrões, onde ficam as difíceis, pausa DOM aproximada, lista especial como seleção fixa confirmada em dicionário, validação real e limitações), `AGENTS.md`/`CLAUDE.md` (sem `marked`/amarelo, sem gravadores distribuídos com debounce, HTML5 com cores e atalhos, ponte Netflix com `probe`, contexto de estudo, roteador, pausa automática e persistência serializada) e `CONTINUAR-AQUI.md` reescrito como estado atual. Gates finais abaixo.

### Fechamento (18/10/2026)

- `npm run typecheck`: aprovado.
- `npm test`: **476 testes em 32 arquivos** aprovados (base anterior à implementação: 298 em 21; checkpoint recebido: 334 em 26).
- `npm run build`: aprovado; `git diff --check`: aprovado.
- Build inspecionado: `dist/content.js` contém a lista especial local; `popup.js`/`library.js` usam `study-client.js` (`sf:study:*`), sem `chrome.storage.local.set`; manifesto com `permissions: ["storage"]` e os três hosts de provedores.
- Execução em Chrome headless: fixture 17/17, página com forma de Netflix 12/12 (seção acima).
- Não verificado em player real Netflix, Max ou Cinetaro.

Ambiente desta etapa: Node 22.23.3, npm 10.9.9 (o checkpoint usou Node 24.19.0/npm 11.9.0; sem mudança de dependências).

## Validação do checkpoint de transferência

Em 18/10/2026, após o pedido de passagem para outra IA:

- `npm run typecheck`: aprovado.
- `npm test -- --maxWorkers=2`: **334 testes em 26 arquivos passaram**.
- `npm run build`: aprovado, os quatro bundles e os arquivos públicos foram gerados.
- `git diff --check`: aprovado.
- Node.js 24.19.0; npm 11.9.0.
- Nenhum player real Netflix/Max/Cinetaro foi validado nesta implementação. Não houve teste de browser da fixture nesta etapa.

Esses resultados validam o código presente e os testes controlados, não a conclusão das funcionalidades ainda sem integração. O guia de retomada está em `docs/CONTINUAR-AQUI.md`, e a especificação integral foi preservada em `docs/StreamFluent-especificacao-implementacao.md`. Checkpoint do código parcial do bloco 5: `c20091b074460ea831706a84eca8631fbb12fe2f`.

## Rodada 2 — níveis, tela cheia, dados locais e tradução (18/10/2026)

Branch `feat/levels-fullscreen-local-data`, a partir de `f267ee1`.

### Relato do usuário na Netflix real

O usuário usou a versão dos blocos 1–10 na **Netflix real** (episódio do Gumball) e relatou que tudo funcionou, com quatro exceções: a fala traduzida chega alguns segundos depois (defeito antigo); nenhuma palavra ficou lilás; o botão **Aa** ficava sobre o botão de tela cheia; e a camada não funcionava em tela cheia. O lilás vazio era esperado (opção desligada por padrão; lista de 100 palavras raras, ausentes de um desenho infantil). Este é o primeiro relato de uso em player real; as correções abaixo **ainda não foram vistas na Netflix real**.

### Blocos

| Bloco | Commit | Conteúdo |
|---|---|---|
| Botão e tela cheia | `7855cd2` | Botão e painel na borda direita, a meia altura, sumindo com o mouse parado; avisos no topo; todas as raízes da camada movidas para o elemento em tela cheia (e de volta), reanexadas se o player as remover; cliques nos nossos controles não chegam ao player. |
| Níveis A1–C2 | `2bc95e9` | Pergunta de nível na instalação (`welcome.html`), na primeira legenda em inglês e no popup/painéis; lilás = acima do nível, sobre a lista CEFR-J + Octanove (~9.700 palavras, CC BY-SA 4.0) com flexões; as 100 especiais fora da lista contam como acima de C2; sem nível, vale a lista fixa antiga. |
| Desempenho e espaço | `ebfab45` | Histórico de palavras vistas no IndexedDB do worker, com índice em memória; migração do histórico antigo sem perda; `unlimitedStorage`. |
| Leitura inicial | `d168908` | Adaptadores Netflix/Max leem a fala já na tela quando começam a observar (antes, uma fala parada ficava invisível até a próxima). Achado pela execução headless repetida. |
| Backup | `ae23aea` | Exportar, importar (mesclando) e recomeçar (só o histórico, ou tudo exceto preferências) na biblioteca. |
| Tradução | `f5227bd` | MyMemory entra se o Google não responder em 1,2 s, ou na hora se ele falhar; links Linguee/WordReference/Reverso/Cambridge no cartão. |

### Verificação

- `npm run typecheck`, `npm test` (**546 testes em 36 arquivos**), `npm run build` e `git diff --check`: aprovados.
- Chrome 155 headless, perfil temporário, rede externa bloqueada, mesmo método da rodada 1:
  - página com forma de Netflix: **20/20**. Além do que já era coberto: página de boas-vindas na instalação, pergunta de nível na primeira legenda, clique real em "A1" grava o nível e pinta a palavra A2 de lilás, perfil antigo com histórico migrado para o IndexedDB ("Hello" já não fica azul), tela cheia real do contêiner com a camada dentro dela e as palavras por cima, clique na palavra em tela cheia sem o player receber o clique, botão na borda direita em tela cheia e sumindo com o mouse parado;
  - a mesma página, repetida 6 vezes depois da correção da leitura inicial: 6/6 (antes da correção, 1 em 5 falhava);
  - `player-test.html`: **17/17**;
  - biblioteca: **4/4** — exportação baixa `streamfluent-backup-AAAA-MM-DD.json`, "Apagar todos os dados" esvazia storage e IndexedDB mantendo o nível, importar o arquivo pelo seletor restaura marcas, frases e histórico.
- Não verificado: Netflix real com estas mudanças, Max e Cinetaro reais, tempo real de resposta dos tradutores (a rede estava bloqueada), e se os sites de dicionário abrem com as URLs geradas (eles bloqueiam acesso automatizado; o Linguee respondeu 200).

### Painel do player redesenhado

Pedido do usuário: fundo cinza, opções menos genéricas e separadas, compreensível para leigo, com um mapa de cores e um de teclas. O painel do **Aa** (Netflix/Max) virou `ui/settings-panel.ts`: fundo cinza neutro, três abas (**Ajustes**, **Cores**, **Teclas**), seções com título, chaves no lugar das caixas de seleção, textos em português sem jargão ("Idioma da legenda: Inglês (traduzir para português)" no lugar de "EN → PT"). Cores: cada cor numa faixa escura, como na legenda, com o significado; as chaves do azul e do lilás ficam na linha da cor, que esmaece quando desligada, e o lilás diz o nível escolhido. Teclas: mini teclado na posição real (Q W E R / A S D / Espaço), outras teclas e ações do mouse. Os `data-sf` e handlers não mudaram. O painel do HTML5 (Cinetaro) não foi alterado.

Verificação: typecheck, **551 testes em 36 arquivos** (5 novos: abas, fechar, mapa de cores, esmaecer/nível, e cada tecla desenhada conferida contra `commandFor`), build; capturas das três abas no Chrome headless; página com forma de Netflix de novo **20/20**. Não visto na Netflix real (o CSS da Netflix pode afetar botões dentro do contêiner em tela cheia).

O que ficou para depois está em [proximos-passos.md](proximos-passos.md).
