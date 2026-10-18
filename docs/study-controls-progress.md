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

## Validação do checkpoint de transferência

Em 18/10/2026, após o pedido de passagem para outra IA:

- `npm run typecheck`: aprovado.
- `npm test -- --maxWorkers=2`: **334 testes em 26 arquivos passaram**.
- `npm run build`: aprovado, os quatro bundles e os arquivos públicos foram gerados.
- `git diff --check`: aprovado.
- Node.js 24.19.0; npm 11.9.0.
- Nenhum player real Netflix/Max/Cinetaro foi validado nesta implementação. Não houve teste de browser da fixture nesta etapa.

Esses resultados validam o código presente e os testes controlados, não a conclusão das funcionalidades ainda sem integração. O guia de retomada está em `docs/CONTINUAR-AQUI.md`, e a especificação integral foi preservada em `docs/StreamFluent-especificacao-implementacao.md`. Checkpoint do código parcial do bloco 5: `c20091b074460ea831706a84eca8631fbb12fe2f`.
