# StreamFluent

Extensão Chrome Manifest V3 para estudar idiomas com legendas. Netflix e Max usam as legendas já renderizadas no DOM. O novo modo HTML5, habilitado para Cinetaro, lê faixas acessíveis ou um arquivo SRT/VTT local e usa o tempo real do vídeo.

**Situação:** implementação e testes controlados disponíveis; compatibilidade com o player real do Cinetaro e reprodução real da Netflix ainda precisam de validação no navegador. A inspeção do site ficou indisponível no ambiente de desenvolvimento. Não há transcrição de áudio nem recuperação automática de falas ausentes.

## Instalar e recarregar

```bash
npm install
npm run typecheck
npm test
npm run build
```

1. Abra `chrome://extensions`, ative o modo de desenvolvedor e carregue a pasta `dist/` em **Carregar sem compactação**.
2. Se já estiver instalada, clique em **Recarregar** na extensão depois do build.
3. Recarregue também a aba do streaming para substituir o content script antigo.

`npm run watch` recompila os bundles; alterações em `public/` exigem um novo build. Não há comando de lint.

## Usar no Cinetaro / HTML5

Abra `https://cinetaro.to/watch/62560?ep=8` e inicie o player. No painel StreamFluent:

1. Selecione uma faixa acessível ou importe um arquivo `.srt`/`.vtt` em UTF-8, até 2 MB. Informe se o arquivo já está em português ou se está em inglês.
2. Ative a camada de legendas. A importação fica apenas em memória, sem upload do arquivo.
3. Ative a tradução para português brasileiro se quiser enviar a fala atual ao tradutor. O texto original continua disponível enquanto a tradução está pendente ou falha.
4. Use **Adiantar 0,5 s** quando a legenda aparece depois da fala; use **Atrasar 0,5 s** quando aparece antes. **Restaurar** volta a zero.

Exemplo: uma fala marcada em 10–12 s aparece em 9,5–11,5 s após adiantar e em 10,5–12,5 s após atrasar. O intervalo é fechado no início e aberto no fim. Pausa, busca e velocidade usam `video.currentTime`, sem acumular um relógio separado.

Trocar episódio, fonte de mídia ou elemento de vídeo descarta a faixa importada e o ajuste. Respostas de tradução antigas não podem substituir as da nova sessão. Selecionar uma nova faixa também restaura o ajuste.

Um deslocamento fixo não resolve descompasso crescente ou legendas de outra edição. Falas ausentes precisam de uma faixa mais completa: tradução não cria texto ausente.

## Netflix e Max

O fluxo anterior permanece: habilite legendas no site, clique nas palavras da camada StreamFluent para consultar tradução/definição e salve frases na biblioteca local. O botão **Aa** e o popup controlam direção e linha traduzida. Arraste a legenda para mudar a posição. A biblioteca abre pelo service worker.

## Player de teste local

No popup, clique em **Testar player local**. A página contém um vídeo sintético de 15 segundos, sem downloads externos, e uma faixa de exemplo. Os arquivos de importação estão em `public/fixtures/`.

Checklist manual ainda pendente neste ambiente:

- Ativar a camada e a tradução; conferir texto e acentos.
- Importar `example.srt` e `example.vtt`; conferir múltiplas linhas e intervalos.
- Pausar, buscar para 10 s e mudar para 2x; verificar que a legenda segue o vídeo.
- Aplicar cada ajuste e restaurar; conferir os intervalos do exemplo acima.
- Trocar episódio e substituir vídeo durante uma tradução; confirmar descarte da fonte e do resultado antigo.
- Desativar a camada; conferir restauração das legendas nativas.
- Entrar/sair da tela cheia do contêiner; conferir painel, legenda e ausência de duplicatas.
- Repetir Netflix/Max com conteúdo real e inspecionar os domínios dos frames do Cinetaro.

Os testes automatizados usam DOM e respostas de rede controladas. Eles não substituem reprodução em Chrome nem comprovam CORS, políticas de fullscreen ou estrutura dos sites reais. Uma chamada isolada ao endpoint Google respondeu `Bom dia.` para `Good morning.` durante o desenvolvimento; isso não garante disponibilidade contínua.

Validação desta entrega: **172 testes em 14 arquivos passaram**, assim como `npm run typecheck`, `npm run build` e `git diff --check`. Inclui regressões DOM de Netflix/Max, importação, ajuste, respostas antigas, transporte e limpeza. Reprodução manual em navegador continua pendente.

## Privacidade e rede

- Sem download de streaming, contorno de DRM, telemetria ou análise de áudio.
- As únicas APIs externas são `clients5.google.com` e `api.mymemory.translated.net` para tradução, e `api.dictionaryapi.dev` para definições em inglês.
- Saem somente a fala atual e, no fluxo de consulta, a palavra selecionada. Título, episódio, biblioteca e arquivo completo não são enviados.
- Tradução no modo HTML5 exige ativação visível. Não há tradução antecipada ou em lote.
- O worker valida destinos, usa timeout por provedor e não envia cookies nem segue redirecionamentos.
- Frases salvas ficam em `chrome.storage.local`; não são sincronizadas.
- Não há chaves ou assinatura nova. O endpoint Google é não documentado e pode recusar chamadas ou mudar. MyMemory possui limites próprios. Nenhum deles tem disponibilidade ou uso ilimitado garantido.

## Limitações

- Apenas vídeos e faixas que o navegador permite ler. Legendas em imagem, áudio sem faixa e formatos diferentes de SRT/VTT não são suportados.
- Frames de outro domínio não recebem permissões genéricas. A interface informa a indisponibilidade; é necessário identificar o host real antes de adicionar suporte específico.
- Tela cheia do contêiner pode hospedar a camada. Tela cheia nativa do próprio elemento de vídeo pode impedir overlays HTML; use a do contêiner ou saia desse modo.
- A versão HTML5 não inclui o cartão de palavras/biblioteca do fluxo Netflix/Max.
- Os seletores DOM da Netflix/Max continuam sujeitos a mudanças dos sites.
- A detecção de episódio usa URL e fonte do vídeo. Players que trocam conteúdo mantendo ambos exigem integração específica.

## Código

- `src/adapters/netflix.ts`, `max.ts`: extração DOM existente.
- `src/adapters/html5-player.ts`, `src/core/player-types.ts`: descoberta de vídeo, frames acessíveis, eventos e sessões.
- `src/core/subtitles.ts`: parsing, UTF-8, intervalos, ajuste e controle assíncrono.
- `src/core/ui/timed-subtitles.ts`: importação, faixas e controles HTML5.
- `src/core/translation.ts`, `translation-request.ts`: tradutor reutilizado e transporte restrito.
- `src/background/background.ts`: solicitações externas e abertura da biblioteca.
- `src/content/content.ts`: integração e limpeza dos dois fluxos.
- `src/__tests__/`: testes de parsing, sincronização, DOM, armazenamento e tradução.

`public/popup.js` e `library.js` são JavaScript sem compilação TypeScript; mudanças de schema/detecção precisam manter as cópias coerentes.
