# StreamFluent

Extensão Chrome Manifest V3 para estudar idiomas com legendas. Netflix e Max usam as legendas já renderizadas no DOM. O modo HTML5, habilitado para Cinetaro e seu player incorporado `cinextream.cc`, lê faixas acessíveis ou um arquivo SRT/VTT local e usa o tempo real do vídeo.

**Situação:** implementação e testes controlados disponíveis; compatibilidade com o player real do Cinetaro e reprodução real da Netflix ainda precisam de validação no navegador. A inspeção do site ficou indisponível no ambiente de desenvolvimento. Não há transcrição de áudio nem recuperação automática de falas ausentes.

## Instalar e recarregar

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build
```

1. Abra `chrome://extensions`, ative o modo de desenvolvedor e carregue a pasta `dist/` em **Carregar sem compactação**.
2. Se já estiver instalada, clique em **Recarregar** na extensão depois do build.
3. Recarregue também a aba do streaming para substituir o content script antigo. Se o navegador solicitar o novo acesso a `cinextream.cc`, conceda esse domínio para conectar o player incorporado.

`npm run watch` recompila os bundles; alterações em `public/` exigem um novo build. Não há comando de lint.

## Conta, sincronização e backup

Abra **Conta e backup** no popup ou na biblioteca. O modo padrão continua somente neste dispositivo.

1. Crie uma conta com e-mail/senha; confirme o e-mail antes de entrar (a API do projeto confirmou e-mail habilitado, cadastro aberto e confirmação obrigatória). Login não envia sua biblioteca.
2. Leia e marque o consentimento. **Ativar e restaurar/sincronizar** combina frases salvas, palavras difíceis/aprendidas e preferências com a conta. Inclui os contextos e traduções já salvos, nunca os arquivos SRT/VTT completos nem o histórico de palavras apenas vistas.
3. Confira **Salvo neste dispositivo** e **Sincronizado na conta** separadamente. Edições locais confirmadas continuam disponíveis offline. Após alterações, um alarme tenta sincronizar em aproximadamente 30–60 segundos; outro tenta/puxa atualizações a cada 5 minutos. **Sincronizar agora** força uma tentativa. A confirmação mostra data/hora, pendências, erros ou conflitos.
4. Ao instalar em outro computador ou reinstalar, entre na mesma conta e ative a sincronização para restaurar os dados **já sincronizados**. Desinstalar ou sair não remove a cópia da conta. Dados que ficaram somente no dispositivo exigem um backup prévio.
5. Mudanças em dispositivos diferentes são comparadas com a última base confirmada. Exclusões contra itens inalterados são propagadas; edição contra exclusão ou duas edições distintas exige escolher por item entre dispositivo e conta. Revisões condicionais rejeitam envios desatualizados. Não há regra de “última data vence”.
6. **Exportar backup** gera JSON pessoal sem senha/sessão/tokens. A importação (até 4 MB) é aditiva, tem prévia e confirmação, mantém a versão local nos conflitos e informa quantos manteve. Preferências do arquivo só participam mediante opção explícita. Com sincronização ativa, as adições também serão sincronizadas.

Uma biblioteca fica vinculada à primeira conta usada no perfil Chrome. Sair conserva dados e vínculo. Para outra conta, use outro perfil Chrome; não há troca automática que possa enviar os dados da conta anterior. Google OAuth não está implementado e está desabilitado no projeto.

O Supabase usado é `ttzpioosgfacsutwmhif` (Streamfluent). A migração versionada está em `supabase/migrations/`; **já foi aplicada neste projeto**. Não a reaplique manualmente. `supabase/tests/account_rls.sql` verifica isolamento com duas identidades sintéticas e papel anônimo em transação com rollback. Não são criadas sessões nem enviados e-mails nesse teste.

Não há segredo de backend para configurar na extensão: URL/chave publicável identificam o destino, e o banco exige sessão e RLS. Se usar outro projeto, configure Auth, aplique a migração e atualize juntos a URL/chave publicável do worker e a permissão exata do manifesto. Nunca use `service_role`, senha do banco ou chave administrativa.

**Validação desta integração:** consulte `docs/study-controls-progress.md`. Lógica/DOM e SDK com HTTP controlado foram testados; RLS e CAS foram testados no Supabase real. Cadastro, recebimento/confirmação do e-mail, login em Chrome, notificações entre abas sob storage restrito, alarmes MV3 e restauração após reinstalação real ainda precisam de validação manual. O Chrome não estava disponível e seu download falhou neste ambiente. Não foi enviado e-mail de teste. Se o provedor padrão de e-mail limitar destinatários, configure o SMTP do projeto antes de disponibilizar cadastro para terceiros.

## Usar no Cinetaro / HTML5

Abra `https://cinetaro.to/watch/62560?ep=8` e inicie o player. A extensão executa dentro do frame `cinextream.cc`, mantendo apenas um painel ativo. O topo transmite a troca de episódio por mensagens internas validadas, sem enviar a URL para os tradutores. No painel StreamFluent:

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

Validação histórica anterior aos controles de estudo: **225 testes em 17 arquivos passaram**, assim como `npm run typecheck`, `npm run build` e `git diff --check`. Inclui regressões DOM de Netflix/Max, importação, ajuste, respostas antigas, transporte, diagnóstico de frames e limpeza. Reprodução manual em navegador continua pendente.

## Privacidade e rede

- Sem download de streaming, contorno de DRM, telemetria ou análise de áudio.
- Tradução/dicionário continuam restritos a `clients5.google.com`, `api.mymemory.translated.net` e `api.dictionaryapi.dev`. A conta opcional usa exclusivamente `ttzpioosgfacsutwmhif.supabase.co` para Auth/Data API.
- Aos tradutores saem somente a fala atual e a palavra consultada. Título, episódio, biblioteca e arquivo completo não são enviados aos provedores. À conta Supabase, somente após consentimento, vão os itens pessoais e preferências descritos acima.
- Tradução no modo HTML5 exige ativação visível. Não há tradução antecipada ou em lote.
- O worker valida destinos, usa timeout por provedor e não envia cookies nem segue redirecionamentos.
- O worker é o único gravador dos dados de estudo. `chrome.storage.local` é restrito a contextos confiáveis; scripts de players recebem invalidações sem tokens e usam mensagens validadas para reler settings/vocabulário. A sincronização é opcional e pode ser pausada.
- A única chave distribuída é a publicável do Supabase. Não há chave administrativa na extensão. O endpoint Google é não documentado e pode recusar chamadas ou mudar. MyMemory possui limites próprios. Nenhum deles tem disponibilidade ou uso ilimitado garantido.

## Limitações

- Apenas vídeos e faixas que o navegador permite ler. Legendas em imagem, áudio sem faixa e formatos diferentes de SRT/VTT não são suportados.
- O domínio `cinextream.cc` foi identificado pelo diagnóstico do usuário e recebeu uma entrada específica no manifesto. Outros hosts continuam sem suporte. O aviso lista as origens declaradas dos frames; `iframe.src` pode diferir da origem final após redirecionamento. Enquanto o vídeo estiver inacessível, a importação fica desativada por falta de relógio para sincronizar.
- Tela cheia do contêiner pode hospedar a camada. Tela cheia nativa do próprio elemento de vídeo pode impedir overlays HTML; use a do contêiner ou saia desse modo.
- A versão HTML5 não inclui o cartão de palavras/biblioteca do fluxo Netflix/Max.
- Os seletores DOM da Netflix/Max continuam sujeitos a mudanças dos sites.
- A detecção de episódio usa URL e fonte do vídeo. Players que trocam conteúdo mantendo ambos exigem integração específica.

## Continuidade dos controles de estudo

Os blocos 1–4 estão implementados; bloco 5 permanece parcial; 6–10 permanecem pendentes. A integração de conta é o objetivo adicional C1–C4 e não conclui atalhos, auto-pause ou palavras interativas no HTML5. Leia `docs/CONTINUAR-AQUI.md`, `docs/study-controls-progress.md` e `docs/account-sync-plan.md` antes de continuar. Nunca usar `video.currentTime` como fallback na Netflix.

## Código

- `src/adapters/netflix.ts`, `max.ts`: extração DOM existente.
- `src/adapters/html5-player.ts`, `src/core/player-types.ts`: descoberta de vídeo, frames acessíveis, eventos e sessões.
- `src/core/subtitles.ts`: parsing, UTF-8, intervalos, ajuste e controle assíncrono.
- `src/core/ui/timed-subtitles.ts`: importação, faixas e controles HTML5.
- `src/core/translation.ts`, `translation-request.ts`: tradutor reutilizado e transporte restrito.
- `src/background/background.ts`: solicitações externas e abertura da biblioteca.
- `src/content/content.ts`: integração e limpeza dos fluxos.
- `src/content/cinetaro-session.ts`, `src/core/frame-messages.ts`: coordenação dos frames, sessão do episódio e validação das mensagens.
- `src/__tests__/`: testes de parsing, sincronização, DOM, armazenamento e tradução.

`public/popup.js` e `library.js` são JavaScript sem compilação TypeScript; mudanças de schema/detecção precisam manter as cópias coerentes.
