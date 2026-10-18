# StreamFluent — especificação de implementação

Documento para o agente implementar as decisões de produto, em blocos com commits separados.

- Repositório: https://github.com/vitinzx7/StreamFluent
- Base inspecionada: `8dd950512dab8b6439e4391b8064bb060632a72d`.
- Data da análise e da consulta às fontes: **17/10/2026**.
- Revisão final do documento: **18/10/2026**.
- Entrega deste documento: arquitetura, comportamentos, dados e critérios de aceite. **Nenhuma implementação ou commit no repositório foi feito na preparação deste arquivo.**

## 1. Instrução para o agente

Implemente os blocos da seção 11 na ordem indicada. Ao concluir e verificar cada bloco, faça o commit correspondente antes de iniciar o próximo. O objetivo é entregar as funcionalidades completas; este documento resolve as escolhas de comportamento necessárias para isso.

Leia o `AGENTS.md` atual e compare o checkout com a base acima. Se o repositório tiver evoluído, adapte os pontos de integração mantendo estas regras de produto. Preserve alterações já existentes no workspace. Não apague trabalho do usuário para obter uma árvore limpa.

Use uma branch de trabalho, por exemplo `feat/study-controls-vocabulary`. Antes de cada commit, confira o diff e adicione somente os arquivos daquele bloco. Não faça commits vazios, não use `git add .` sem revisar o conteúdo, não faça force push e não publique uma versão da extensão automaticamente. O pedido prevê **commits locais por bloco**, não merge, publicação ou envio remoto automático.

Crie `docs/study-controls-progress.md` no repositório para registrar os blocos concluídos, os testes executados e as pendências reais. O hash de um commit só existe depois de criá-lo: registre-o na resposta final ou na atualização seguinte do progresso; não tente inserir o próprio hash no mesmo commit.

As regras a seguir são obrigatórias. A organização interna dos módulos pode acompanhar o padrão do projeto, desde que mantenha as responsabilidades e os resultados definidos aqui.

## 2. Decisões fechadas de produto

### 2.1 Atalhos

| Tecla | Nome na interface | Comportamento |
|---|---|---|
| `A` | Fala anterior | Preservar a navegação existente pela fala anterior e suas regras para silêncio e trechos ainda não assistidos. |
| `S` | Repetir fala | Voltar ao começo da fala de estudo e reproduzi-la uma vez. Não ativar repetição em loop. |
| `D` | Avançar 5 s | Avançar cinco segundos no vídeo. Não procurar a próxima legenda. |
| `Espaço` | Reproduzir / pausar | Alternar o estado real de reprodução. |
| `Q` | Pausa automática | Ligar ou desligar a pausa ao final de cada fala. |
| `R` | Salvar fala | Salvar a legenda original completa que está sendo estudada, mesmo sem selecionar uma palavra. |
| `Ctrl+C` / `⌘C` | Copiar fala | Copiar a legenda original completa quando não houver seleção de texto nem campo em edição. |

O avanço de `D` substitui a ideia inicial de “Next”. Não implementar dez segundos, nem salto ao próximo cue, nem alterar os botões nativos de dez segundos da Netflix.

### 2.2 Mouse

| Ação | Resultado |
|---|---|
| Clique direito em uma palavra da legenda original | Marcar e salvar como **Difícil** imediatamente. Fica vermelha e aparece em “Palavras difíceis”. |
| Clique esquerdo em uma palavra | Abrir o cartão com tradução, dicionário quando disponível e opções de marcação. |
| “Difícil” no cartão | Definir marca pessoal vermelha. |
| “Aprendida” no cartão | Definir marca pessoal verde. |
| “Remover marcação” no cartão | Remover somente a marca pessoal; a cor automática volta a ser calculada. |

A decisão mais recente prevalece: **clique direito salva como difícil; clique esquerdo abre o cartão**. O clique direito não precisa de tradução, não abre o dicionário, não salva uma frase adicional e não depende de conexão.

Escolher uma cor significa escolher um desses estados. Não criar seletor livre de cores. Azul e lilás são resultados automáticos e não são opções de marcação manual.

### 2.3 Cores e prioridade

| Estado | Cor | Valor CSS | Origem | Onde é salvo |
|---|---|---|---|---|
| Normal | Branco | `#FFFFFF` | Palavra já vista, sem outra regra visual ativa | Não persistir como marca. |
| Nova | Azul claro | `#8ECBFF` | Primeira aparição registrada, com destaque de novas ligado | Salvar que foi vista; a cor pertence àquela ocorrência. |
| Difícil | Vermelho | `#FF8A80` | Escolha pessoal por clique direito ou cartão | Vocabulário pessoal. |
| Aprendida | Verde | `#81C784` | Escolha pessoal no cartão ou na biblioteca | Vocabulário pessoal. |
| Especial | Lilás | `#C4A5FF` | Palavra encontrada na lista fixa deste documento, com opção ligada | Lista estática da extensão; não é marca pessoal. |

Manter o fundo escuro e a sombra das legendas para legibilidade. A cor de uma palavra não deve alterar espaços, pontuação, tamanho ou altura da linha. A tradução da frase mantém a apresentação atual: os destaques se aplicam à **legenda no idioma de origem**, sem tentar alinhar palavra por palavra com a tradução.

Ordem de resolução:

1. Se existe marca pessoal `difficult` ou `learned`, mostrar essa marca.
2. Caso contrário, se o idioma de origem é inglês, o destaque de especiais está ligado e a palavra está na lista, mostrar lilás.
3. Caso contrário, se o destaque de novas está ligado e a palavra pertence às novas daquela ocorrência, mostrar azul claro.
4. Caso contrário, mostrar normal.

`difficult` e `learned` são mutuamente exclusivos. Não existe conflito vermelho versus verde: uma nova escolha substitui a anterior. A antiga marca `marked`, amarela, será migrada para `learned`; remover “Mark” e amarelo das interfaces e legendas.

Exemplos de resultado: uma palavra especial aprendida fica verde; uma especial difícil fica vermelha. Remover a marca pessoal revela lilás quando a opção está ligada. Desligar especiais não apaga a lista, marcas ou histórico de palavras vistas. Desligar novas não remove vermelho, verde nem lilás.

### 2.4 Configurações

Adicionar a `Settings`, à normalização, ao popup e aos controles do player:

| Campo | Padrão de instalação/migração | Efeito |
|---|---|---|
| `highlightSpecialWords` | `false` | Botão/checkbox “Destacar palavras especiais”. |
| `autoPause` | `false` | Botão/checkbox “Pausa automática”. Também alterado por `Q`. |
| `highlightNewWords` | Preservar; padrão atual `true` | Continuar controlando apenas o azul. |

Persistir as preferências localmente e sincronizar mudanças entre popup, painel e players abertos. Após o usuário ligar especiais, manter a escolha nas próximas sessões. “Desligado por padrão” não significa desligar toda vez que um episódio começa.

No modo português → inglês, especiais não classificam palavras portuguesas. Manter a preferência salva e explicar no controle que a lista é de inglês. Não transformar uma palavra portuguesa em especial porque sua grafia coincide com uma entrada inglesa.

Não implementar seletor A1/A2/B1/B2/C1/C2, detecção por IA, limite pessoal de dificuldade, classificação contextual ou edição manual da lista especial nesta versão.

## 3. O que já existe e onde integrar

| Arquivo existente | Situação observada / alteração necessária |
|---|---|
| `src/content/content.ts` | Orquestra Netflix/Max, traduções, vocabulário, overlay e `A`. Integrar os novos controladores sem concentrar todas as regras aqui. |
| `src/core/vocabulary.ts` | Tem `seen`, `difficult` e `marked`; gravações com debounce de 1 s. Migrar a marca e garantir confirmação durável dos cliques. |
| `src/core/settings.ts` | Normaliza preferências e observa mudanças. Adicionar campos sem apagar os existentes. |
| `src/core/storage.ts` e `src/core/types.ts` | Frases exigem palavra selecionada. Passar a aceitar salvamento de frase completa e validar dados legados. |
| `src/core/ui/subtitle-overlay.ts` | Tem clique esquerdo, cartão, cores, painel e arraste. Adicionar contexto direito, estados de salvamento e novos controles. |
| `src/core/line-navigation.ts` e `line-timeline.ts` | Implementam `A`, histórico aprendido e alvo pendente. Reaproveitar o algoritmo; retirar o listener de teclado duplicado ao centralizar atalhos. |
| `src/adapters/netflix.ts` e `src/core/netflix-bridge.ts` | Seek Netflix passa por API da página via ponte MAIN. Preservar essa exigência. |
| `src/content/netflix-main.ts` | Entrada da ponte no mundo da página. Ajustar se o protocolo ganhar controles de reprodução. |
| `src/adapters/max.ts` | Seek atual escreve no vídeo; precisa de verificação real na Max. |
| `src/core/subtitles.ts` e `src/core/ui/timed-subtitles.ts` | Caminho HTML5 com tempos reais, offset e Shadow DOM. Hoje não tem palavras interativas. |
| `src/content/cinetaro-session.ts` e `src/core/frame-messages.ts` | Coordenam uma instância proprietária do player, inclusive frame permitido. Preservar o controle de sessão e a validação do relay. |
| `src/background/background.ts` | Worker MV3 com mensagens de provedores, biblioteca e frames. Acrescentar o serviço local de persistência. |
| `public/popup.html`, `public/popup.js` | Código JS não passa pelo bundle TypeScript. Atualizar controles e acessos a dados explicitamente. |
| `public/library.html`, `public/library.js` | Biblioteca atual de frases. Acrescentar vistas de difíceis/aprendidas e suportar frases sem palavra selecionada. |
| `src/__tests__/` | Há testes de navegação, timeline, overlay, vocabulário, settings, HTML5 e frames. Estender os casos relevantes. |

Os nomes sugeridos para novos módulos são: `word-normalization.ts`, `word-status.ts`, `special-words.ts`, `study-storage.ts`, `study-messages.ts`, `study-context.ts`, `playback-controller.ts`, `keyboard-shortcuts.ts`, `auto-pause.ts` e `ui/word-renderer.ts`. Criar somente os que tenham responsabilidade própria; não gerar arquivos vazios para cumprir a lista.

## 4. Dados, migração e persistência

### 4.1 Identidade das palavras

A identidade pessoal é o par **idioma de origem + palavra normalizada**. Uma mesma palavra em episódios ou plataformas diferentes usa a mesma marca. Inglês e português têm históricos separados.

Centralizar a normalização usada por renderização, histórico, marcas, biblioteca e lista especial. Usar Unicode NFC, minúsculas, converter apóstrofo tipográfico para `'` e retirar apenas pontuação externa. Manter letras acentuadas, apóstrofos internos e hífens internos. Tokens vazios ou compostos somente de pontuação não são palavras clicáveis.

Separar texto e pontuação na renderização sem modificar o texto original. Contrair `don't` em uma palavra e manter compostos com hífen como um token; não transformar `word—other` em `wordother`. Conservar os espaços e quebras de linha da legenda. Não usar `innerHTML` com texto recebido de legendas, arquivos, storage ou provedores.

Nesta versão, a classificação especial corresponde à **forma escrita normalizada exata**. `EPHEMERAL,` reconhece `ephemeral`; `ephemerally` não entra por semelhança. Não remover sufixos com regras improvisadas nem considerar que marcar `go` marca `went`. O conjunto inicial tem 100 entradas, sem aliases implícitos. Isso mantém marcações pessoais previsíveis e evita falsos positivos.

### 4.2 Modelo do vocabulário

Manter a chave de storage `vocabulary`, migrando seu conteúdo para um envelope versionado:

```ts
type PersonalMark = "difficult" | "learned";
type DisplayStatus = "normal" | "new" | "special" | PersonalMark;

interface WordContext {
  sentence: string;
  sentenceTranslation?: string;
  platform: string;
  mediaTitle: string;
  season: number | null;
  episode: number | null;
  timeSeconds?: number;
  sourceLanguage: string;
  targetLanguage?: string;
}

interface WordDetails {
  displayWord: string;
  markedAt: string | null; // ISO; null para legado sem data
  updatedAt: string | null;
  context?: WordContext;
  translation?: string;
  definition?: string;
}

interface VocabularyV2 {
  schemaVersion: 2;
  languages: Record<string, {
    seen: string[];
    marks: Record<string, PersonalMark>;
    details: Record<string, WordDetails>;
  }>;
}
```

`marks` é a única fonte do estado pessoal. `details` guarda informações opcionais da marca, sem repetir o status. Uma palavra migrada pode não ter contexto nem tradução. Não inventar episódio, data ou significado para preencher esses campos.

Definir uma marca também inclui a palavra em `seen`. Mudar difícil → aprendida conserva os detalhes existentes e atualiza `updatedAt`; pode incorporar o contexto capturado na nova ação. “Remover marcação” remove a entrada de `marks` e seus `details`, mas conserva `seen` e todas as frases salvas.

Repetir a mesma marca é uma operação idempotente: não cria outra linha na biblioteca, não muda a data da marca e não reordena a lista a cada clique. Um clique direito numa palavra aprendida substitui verde por vermelho por ser uma nova escolha explícita.

### 4.3 Migração obrigatória

O formato atual é um objeto por idioma com `seen` e `marks`, sem envelope. A migração deve:

1. Reconhecer o formato legado e normalizar os campos válidos.
2. Converter toda marca `marked` em `learned`; conservar `difficult`.
3. Recalcular chaves com a normalização única e unir duplicatas de `seen`.
4. Quando chaves antigas diferentes colidirem e tiverem marcas conflitantes, conservar `difficult`. Isso evita perder uma dificuldade explicitamente registrada.
5. Criar detalhes mínimos com `displayWord` igual à chave e datas `null` quando não houver metadados.
6. Acrescentar os novos settings como `false`, preservando direção, tradução, posição e preferência de novas.
7. Migrar frases conforme a próxima seção, preservando IDs e datas válidos.
8. Persistir somente depois de construir e validar o resultado inteiro. Falha de gravação não pode zerar dados legados.

A migração deve ser idempotente: abrir dois players ou reiniciar o worker não repete conversões nem muda datas. Uma versão de schema futura/desconhecida não pode ser reinterpretada como legado e sobrescrita; apresentar erro de versão e manter os dados.

### 4.4 Frase completa e palavra com contexto

Manter a chave `phrases` e adotar união discriminada para os itens:

```ts
interface SavedPhraseBase {
  id: string;
  kind: "word" | "sentence";
  sentence: string;
  sentenceTranslation?: string;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  platform: string;
  mediaTitle: string;
  season: number | null;
  episode: number | null;
  timeSeconds?: number;
  createdAt: string;
}

type SavedPhraseV2 =
  | (SavedPhraseBase & {
      kind: "word";
      selectedWord: string;
      translation?: string;
      definition?: string;
    })
  | (SavedPhraseBase & { kind: "sentence" });
```

Frases legadas com `selectedWord` válido viram `kind: "word"`. Idioma ausente permanece `null`; não usar a preferência atual para adivinhar a direção histórica. Legado sem palavra, mas com frase válida, pode ser recuperado como `sentence`. Descartar campos inválidos sem fazer a lista inteira desaparecer por causa de um item ruim.

O botão existente de salvar palavra + frase continua gerando `kind: "word"`. `R` gera `kind: "sentence"`, sem preencher `selectedWord` com a primeira palavra ou uma string fictícia. Salvar frase não marca palavras como difíceis ou aprendidas.

Deduplicar por `kind`, idiomas, plataforma, título, temporada, episódio, texto original com espaços equivalentes normalizados e, apenas para `word`, palavra normalizada. Maiúsculas do texto da frase continuam significativas; não mesclar frases diferentes por tradução. Ignorar `timeSeconds` na deduplicação, para repetir a mesma ação no mesmo episódio não duplicar o item. Frases iguais em episódios diferentes podem coexistir.

No duplicado, retornar o registro existente e “Já salvo”; não sobrescrever sua data. É permitido preencher tradução antes ausente quando ela pertence exatamente à mesma frase e direção. Dados legados com idioma desconhecido não devem ser fundidos automaticamente com dados de idioma conhecido.

### 4.5 Uma única fila de gravação

O read-modify-write atual com debounce não garante atomicidade entre abas. Para evitar perda de marcas e frases, o **service worker será o único gravador** de `vocabulary`, `phrases`, `settings` e de uma nova chave numérica `studyRevision`.

Os repositórios TS, o popup e a biblioteca enviam operações por `chrome.runtime.sendMessage`. Remover os caminhos antigos que escrevem diretamente essas mesmas chaves, inclusive remoção/limpeza de frases e mudanças no painel. Leituras podem usar snapshots normalizados; notificações usam `chrome.storage.onChanged`.

Protocolo interno sugerido: `sf:study:read`, `sf:study:observe`, `sf:study:set-mark`, `sf:study:save-phrase`, `sf:study:remove-phrase`, `sf:study:clear-phrases`, `sf:study:patch-settings`. A limpeza de difíceis, se exposta, deve ser uma operação própria que só remove marcas difíceis. Não reutilizar “clear phrases” para isso.

Cada pedido leva `requestId` e payload validado. Respostas são `{ ok: true, requestId, revision, data }` ou `{ ok: false, requestId, error }`. Validar a identidade da extensão e os remetentes admitidos; não aceitar esse protocolo diretamente de eventos DOM, da página ou de frames arbitrários. Manter as validações específicas já existentes para outros protocolos.

A fila do worker deve serializar **leitura/migração + aplicação + gravação**, não somente o `set`. Fazer a próxima operação continuar mesmo depois de uma rejeição anterior. Incrementar `studyRevision` e gravá-la junto às chaves alteradas em uma chamada `storage.local.set`. Emitir sucesso somente após a Promise de persistência resolver. Ao reiniciar, recarregar o estado persistido; não depender de memória de worker para recuperar dados já confirmados.

Não usar um debounce de um segundo para marcas, frases ou settings. A UI pode mostrar a cor otimisticamente, com indicação de “Salvando…”, mas só anunciar “Salvo” após confirmação. Em erro, restaurar a marca confirmada e oferecer nova tentativa. Identificar a operação mais recente por palavra: uma falha antiga não pode desfazer uma escolha nova.

Para palavras vistas, enviar chaves únicas por ocorrência. O worker calcula `freshKeys` contra o estado persistido, une `seen`, grava e devolve o resultado. Processamento serial faz duas abas não declararem ambas a mesma palavra como inédita. Deduplicar chamadas do mesmo `occurrenceId` no cliente; não reenviar ao mudar somente cor, tradução ou configuração. Aplicar o resultado visual somente se sessão e ocorrência ainda coincidirem; o registro válido no histórico continua salvo mesmo que a fala já tenha saído da tela.

Quando o storage ainda não estiver pronto, mostrar marcas já conhecidas se houver snapshot seguro e não presumir que tudo é novo. Processar a primeira fala ao concluir a inicialização, se ainda pertencer à mesma sessão. Se a gravação de `seen` falhar, conservar o conjunto provisório apenas em memória, indicar falha de histórico sem inundar a tela e tentar novamente ao próximo evento útil; não afirmar persistência.

Preferências alteram campos por patch; uma mudança em especiais não apaga `subtitleBottom`. Para `Q`, usar uma operação de toggle do campo booleano dentro da mesma fila, ou controle de intenção equivalente que não leia um valor antigo em duas pressões rápidas. Não implementar toggle como dois patches calculados sobre o mesmo snapshot desatualizado.

### 4.6 Limites e privacidade

Todo estado pessoal fica em `chrome.storage.local`, sem conta, sincronização externa ou coleta. A lista especial vem empacotada no build; não consultar Linglify ou Oxford durante a reprodução.

Manter os três hosts atuais de tradução/dicionário e o limite do que sai do dispositivo: palavra consultada e fala atual necessária à consulta/tradução. Não enviar títulos, episódios, listas pessoais ou arquivos SRT/VTT inteiros. Links de fontes são documentação; não são autorização para scraping em segundo plano nem para acrescentar permissões ao manifesto.

Validar strings, enums, tempos finitos, datas e objetos recebidos. Não confiar em protótipos herdados de maps; usar objetos seguros/Maps e chaves próprias. Tratar falha de quota como erro de salvamento, sem limpar o histórico silenciosamente nem solicitar permissões amplas para esconder o problema.

## 5. Palavras novas e especiais

### 5.1 Primeira aparição

“Nova” significa primeira aparição registrada no histórico daquele idioma, não primeira aparição no episódio, na aba ou desde o último reload. Registrar as palavras mesmo com `highlightNewWords` desligado: o botão controla apresentação, não coleta do histórico local.

Guardar `freshKeys` no contexto da ocorrência atual. Re-renderizar a mesma fala, atualizar tradução, alternar especiais ou receber mudanças de storage não pode apagar seu azul. Se a mesma palavra aparece duas vezes nessa primeira fala, ambas as ocorrências ficam azuis. Se a fala for reproduzida novamente depois de sair de cena, a palavra já foi vista e não fica azul de novo.

Separar `cueId`, que identifica a unidade na fonte, de `occurrenceId`, que identifica uma apresentação dessa unidade. Não usar somente o texto como identidade: “Yes.” em dois tempos diferentes são falas diferentes. Para fontes com tempo, combinar sessão + fonte + índice/identificador do cue com uma sequência de apresentação; para DOM, usar sequência local de aparições e tempos observados. Sair da fala e retornar por replay/seek cria outra ocorrência, mesmo que o `cueId` e o texto sejam os mesmos. Uma mudança de marca, tradução ou configuração não cria outra ocorrência.

Registrar a observação quando a fala for efetivamente apresentada na camada, não ao pré-carregar uma faixa inteira. Enquanto uma fala anterior estiver retida pela pausa automática, novas informações do adaptador atualizam apenas a fala ao vivo em memória. Não registrar como vistas palavras que ainda estão ocultas atrás dessa retenção. Ao retomar e exibir a fala seguinte, calcular suas palavras novas normalmente.

### 5.2 Lista especial

A seção 13 traz o conjunto fechado de 100 palavras, com um verbete Oxford confirmado para cada entrada. Extrair esse JSON para `src/data/special-words.en.json` e carregá-lo localmente por `special-words.ts`. Ajustar a importação ou a configuração do compilador conforme o suporte atual a JSON; não buscar o arquivo por URL remota.

Construir um `Set` de chaves normalizadas uma vez. `isSpecialWord(word, sourceLanguage)` retorna verdadeiro apenas para inglês e correspondência exata. Consultar o set é uma operação local simples; nenhuma Promise, chamada de API ou modelo de linguagem deve participar do cálculo de cor.

O teste do conjunto exige exatamente 100 entradas únicas, normalizadas, com URLs Oxford válidas e idioma `en`. Os links e a procedência acompanham os dados para auditoria; não precisam aparecer em cada palavra da legenda.

## 6. Clique, cartão e feedback

### 6.1 Clique direito

Usar `contextmenu` delegado ao contêiner de palavras. Validar se o alvo corresponde a uma palavra da legenda original desta instância. Só nesse caso impedir o menu nativo e a propagação pertinente. Fora da legenda, o menu de contexto do navegador permanece normal.

Capturar imediatamente a palavra, o idioma e o contexto da ocorrência clicada; não reler `currentLine` depois de um `await`. Pedir `set-mark(difficult)` diretamente. Mostrar vermelho e indicação discreta de salvamento; no sucesso, “Adicionada às difíceis”; se já era difícil, “Já está nas difíceis”. Não abrir o cartão e não iniciar tradução como efeito desse clique.

Clique direito não inicia arraste. O evento posterior de clique não pode abrir o cartão por engano. Marcar uma palavra não pausa nem retoma o vídeo automaticamente.

### 6.2 Clique esquerdo

Abrir o cartão imediatamente, com a palavra, seu estado e ações disponíveis mesmo enquanto a tradução carrega. Oferecer “Difícil”, “Aprendida”, “Remover marcação” e a ação existente de salvar palavra + frase. Usar rótulos textuais e estado selecionado, não apenas quadrados coloridos.

As ações de marcação não esperam a rede. A tradução e a definição são complementos; ausência no Dictionary API não impede marcar ou salvar. Em inglês, consultar os provedores já usados; em português, manter a regra atual de não chamar o dicionário que só atende inglês. A confirmação lexical na Oxford não garante que a API gratuita tenha definição para todas as 100 palavras; não acrescentar uma integração Oxford como fallback desta tarefa.

Associar o cartão a um snapshot imutável da palavra/fala clicada. Ele pode continuar aberto enquanto a próxima fala aparece; mostrar seu próprio trecho de contexto para deixar isso claro. `R` e copiar seguem a fala de estudo exibida, não a frase de um cartão antigo. Um novo clique substitui o cartão e invalida os resultados anteriores. Mudança de sessão, idioma, fonte ou fechamento explícito invalida as consultas pendentes.

Respostas assíncronas precisam conferir `lookupId`, sessão e direção antes de atualizar o cartão. A tradução abaixo da legenda precisa conferir a identidade da ocorrência, além do texto: frases iguais de sessões diferentes não podem receber respostas cruzadas.

### 6.3 Arraste, foco e acessibilidade

Preservar o limiar atual de 4 px do arraste vertical. Movimento que ultrapassou o limiar termina em arraste, não em consulta de palavra. O clique suprimido depois de um arraste não deve afetar o clique seguinte.

A área arrastável da legenda conserva seu gesto atual. Nos textos do cartão, da página e do campo de cópia manual, manter seleção nativa; esses elementos não iniciam arraste da legenda. Não limpar seleções para forçar o atalho de cópia. Palavras e botões devem ser acessíveis pelo teclado, com foco visível. `Enter`/`Espaço` num controle focado executam sua ação normal. `Escape` fecha o cartão/painel conforme a interface atual. Não roubar o foco quando chega uma tradução.

Todas as mensagens de sucesso dependem de confirmação real. O cartão atual chama `onSave` e muda o rótulo para salvo antes de esperar a gravação; corrigir esse fluxo para callbacks assíncronos. Um erro não pode deixar “Salvo” na tela.

## 7. Contexto de estudo e controle de reprodução

### 7.1 Contexto único

Criar uma estrutura interna de contexto com `sessionId`, `sourceId`, `cueId`, `occurrenceId`, texto original, tradução correspondente se pronta, idioma/direção, tempos disponíveis, metadados e `freshKeys`. Separar três conceitos:

- **Fala ao vivo:** o que o adaptador/fonte informa agora.
- **Fala retida:** snapshot que permanece na tela após uma pausa automática.
- **Fala de estudo:** a retida, se existir; senão a fala ao vivo visível.

`R`, copiar e `S` usam a fala de estudo. Em um silêncio comum, sem fala retida, `R` e copiar não usam uma frase velha. `A` continua podendo buscar a última fala no histórico, conforme sua lógica atual. `S` sem fala de estudo informa “Nenhuma fala para repetir” e não escolhe uma anterior arbitrariamente.

Trocar episódio, vídeo, fonte de legenda ou idioma invalida contextos, requisições e operações pendentes correspondentes. Mudar só a cor ou ligar especiais não muda a identidade da fala.

### 7.2 Contrato do player

Usar um controlador compartilhado entre atalhos e botões. Ele recebe um driver/adaptador com acesso ao estado real e operações limitadas: `seekTo(seconds)`, `play()` e `pause()`. Cada operação assíncrona informa sucesso/erro ou indisponibilidade; um booleano só é suficiente se o chamador conseguir exibir a falha.

Tempos são sempre **segundos** no domínio. Converter para milissegundos somente na fronteira exigida pela API Netflix. Validar `NaN`, infinitos, ausência de vídeo, duração desconhecida e limites de seek.

Na Netflix, manter `seekTo` pela ponte MAIN e **nunca usar `video.currentTime = ...` como fallback**, pois isso pode provocar M7375. Ampliar a mesma ponte com operações explícitas e validadas de play/pause, mantendo os comandos Netflix no adaptador da plataforma. Validar em runtime a existência de `play`/`pause` no player real. Não inventar que a API não documentada garante esses métodos. Uma indisponibilidade deve falhar de forma controlada, sem seek alternativo nem teclas sintéticas.

O protocolo da ponte deve ter enum fechado de ações e parâmetros conhecidos; não aceitar nomes arbitrários de método nem executar código vindo de mensagens. Manter request ID, timeout, validação e descarte de respostas de sessão antiga. O script MAIN continua sem privilégios de extensão.

No HTML5, usar `video.play()`/`pause()` e tratar rejeição de `play()`. Max mantém seu adaptador próprio. Ler `video.paused` para decidir Space; não manter um booleano desconectado do player.

### 7.3 A — fala anterior

Preservar os testes e o comportamento atuais:

- Durante uma fala, voltar à fala anterior conhecida.
- No silêncio logo após uma fala, repetir a última fala.
- Não saltar minutos para uma fala conhecida quando existe intervalo não assistido entre elas; nesse caso, reiniciar a atual quando isso for o alvo seguro existente.
- Aplicar o pré-roll atual de 0,25 s sem ultrapassar o fim da fala anterior nem tempo zero.
- Pressões rápidas usam o alvo pendente, não um `currentTime` que ainda não mudou.
- Conservar o estado pausado/reproduzindo de antes da ação.

Extrair a ação da instalação do listener atual para que só exista um manipulador de `A`. Não reescrever a timeline do zero sem preservar sua cobertura de trechos assistidos.

### 7.4 S — repetir

Determinar o início da fala de estudo: tempo real da fonte quando disponível; tempo observado na timeline para legendas DOM. Aplicar o mesmo pré-roll seguro de 0,25 s, respeitando a fala anterior. Se o início for desconhecido, informar indisponibilidade; não substituir por retrocesso fixo de cinco/dez segundos.

Buscar o alvo e, após o seek correspondente ser aceito e estabilizado, chamar play. `S` retoma mesmo se o player estava pausado. A ação reproduz uma vez; se a pausa automática estiver ligada, ela pode pausar no fim dessa nova passagem. Não desligar a preferência e não criar loop.

Uma confirmação de recebimento da ponte não prova, sozinha, que o vídeo já chegou ao destino. Aguardar `seeked` ou aproximação do tempo observado ao alvo, com tolerância e timeout limitados; cancelar se a sessão mudar. Não deixar Promises penduradas nem chamar play depois de um seek recusado.

### 7.5 D — avançar cinco segundos

Alvo inicial: tempo atual + `5`. Em pressões rápidas, somar cinco ao último alvo ainda pendente da mesma sequência. Exemplo: em 120 s, duas pressões independentes antes do primeiro seek terminar devem pedir 125 s e depois 130 s, sem cair de volta para 125 s.

Limitar o alvo ao intervalo buscável. Para mídia comum com duração finita, limitar entre zero e duração. Se houver `seekable` com lacunas ou janela ao vivo, não saltar arbitrariamente para uma janela distante: permanecer no intervalo válido atual e limitar a seu fim; quando não houver alvo seguro, retornar indisponível. Não usar `Infinity` como destino.

Conservar pausado/reproduzindo. O fim da mídia pode naturalmente resultar em `ended`; não forçar retomada. `D` funciona mesmo num trecho sem legenda.

Serializar comandos de seek. Identificar cada operação e sua sessão; uma resposta antiga não pode limpar o destino mais recente. Ao concluir/falhar ou ocorrer seek externo, reconciliar o destino pendente com o estado real. Pressões não relacionadas não devem continuar uma sequência expirada; manter a janela atual de 1,5 s como referência de sequência, sem usar esse timer para fingir sucesso do seek.

### 7.6 Espaço — reproduzir / pausar

Alternar a reprodução uma única vez por pressão válida e impedir que a mesma tecla também acione o handler nativo. Se houver operação em andamento, serializar a intenção de toggle e consultar o estado atualizado; duas pressões devem resultar em duas alternâncias, não em duas chamadas calculadas sobre o mesmo booleano antigo.

Retomar após pausa automática libera a fala retida e reexibe a fala ao vivo pertinente. O ato de desligar a pausa automática com `Q` não dá play por conta própria.

## 8. Pausa automática

### 8.1 Comportamento visível

O modo começa desligado. `Q` e o controle “Pausa automática” alteram a mesma preferência persistida. Quando ligado, o player pausa ao final de uma fala, e a última fala fica visível para consulta, cópia e salvamento.

Não usar uma duração fixa de leitura. Não pausar no começo de uma legenda. Não pausar porque alguém clicou em uma palavra. A preferência só define o comportamento no fim da fala.

Ao ativar o modo no meio de uma fala, aguardar seu próximo término normal. Ao ativá-lo em silêncio, aguardar uma fala nova. Ao desligá-lo enquanto o vídeo está pausado, manter o vídeo pausado e a fala retida disponível até retomar, navegar ou trocar de sessão.

### 8.2 Fontes com tempos reais

TextTracks e SRT/VTT fornecem início/fim. Calcular o término no relógio do vídeo, incluindo o offset: `effectiveEnd = cue.end + offset`. Um offset positivo atrasa a exibição e a pausa; um negativo adianta ambos.

Detectar a passagem de antes do término para o término/depois durante reprodução normal. Usar `timeupdate` e, enquanto ativo/visível/reproduzindo, um acompanhamento leve por `requestAnimationFrame` se necessário para reduzir atraso. Cancelar o acompanhamento quando não houver trabalho. Não usar `setTimeout(duraçãoDaFala)` como relógio, porque velocidade, buffering e seeks tornam esse timer incorreto.

A pausa é feita no primeiro ciclo de observação após a fronteira. Não prometer precisão de frame, especialmente em aba em segundo plano. Antes de substituir a fala que acabou pela próxima, capturar o snapshot que será retido.

Para cues com sobreposição temporal positiva, considerar um grupo contínuo de sobreposição e pausar no maior fim do grupo, uma única vez. Cues consecutivos cujo fim/início apenas coincidem não são fundidos: cada fala continua tendo seu término. Reter a última composição de texto realmente exibida no grupo; não concatenar textos que nunca apareceram juntos. Essa regra evita várias pausas para duas linhas simultâneas.

### 8.3 Netflix e Max com legenda DOM

Os adaptadores atuais entregam `start: 0` e `end: 0`. Esses zeros são ausência de informação, **não timestamps válidos**. Não estimar um fim exato que a fonte não fornece.

Nesse caminho, detectar o término pela legenda desaparecer ou ser substituída, após o debounce existente. Pausar somente se havia fala válida e o vídeo estava em reprodução normal. Isso é uma pausa aproximada: a mudança já chegou ao DOM quando a extensão a percebe.

Conservar o snapshot anterior como fala retida, mesmo que a plataforma já tenha mostrado a próxima. Não buscar para trás para compensar o atraso. Se a operação de pause falhar, manter a fala ao vivo e avisar que a pausa não pôde ser feita; não exibir um estado fictício de pausa.

Não interpretar mudança causada por `seeking`, troca de faixa, episódio, fonte, desmontagem do player ou buffering conhecido como fim de fala para pausar. Reaproveitar a filtragem de mutações da extensão para que pintar palavras não dispare uma falsa troca de legenda.

Se o DOM não muda entre duas falas de texto exatamente igual, não há informação suficiente para distinguir as duas ocorrências. Registrar essa limitação; não fabricar eventos por cronômetro.

### 8.4 Estado e prevenção de loops

O controlador guarda modo habilitado, sessão/fonte, passagem de reprodução, fala/grupo armado, término já consumido, operação de pausa pendente e fala retida. Não são todos estados persistidos: persistir apenas a preferência; o restante pertence à sessão.

| Evento | Resultado obrigatório |
|---|---|
| Fala termina durante reprodução normal | Marcar esse término como consumido, solicitar pause uma vez e reter o snapshot no sucesso. |
| Outro callback informa o mesmo término | Não enviar outra pausa. |
| Usuário retoma depois da pausa | Liberar o snapshot retido; não pausar de novo pelo mesmo término consumido. |
| `S` repete uma fala | Nova passagem: essa fala pode pausar novamente ao terminar. |
| `A`, `D` ou seek nativo | Invalidar a armação anterior e o snapshot retido; não pausar por atravessar términos durante o salto. |
| Seek estabiliza | Reconciliar a fala no destino e armar somente um término que ainda esteja à frente. |
| Velocidade muda | Continuar usando tempo do vídeo, sem recalcular timers de parede. |
| Vídeo já está pausado | Não gerar uma segunda pausa por mutação de legenda. |
| Sessão/fonte/idioma muda | Limpar tudo que pertence à sessão antiga e ignorar callbacks atrasados. |

Guardar a decisão de pausa antes de aguardar o driver impede pedidos duplicados. Eventos de reprodução e comandos devem compartilhar a mesma geração de sessão. Uma resposta de pause antiga não pode pausar o episódio seguinte.

## 9. Teclado, salvar e copiar

### 9.1 Um roteador de teclado

Criar `keyboard-shortcuts.ts` com um único listener por contexto de player ativo. Instalar em capture no `defaultView` do documento correto, não presumir que toda interface pertence ao `window` global original. Remover esse listener no cleanup e ao perder a propriedade da sessão/frame.

Ordem de decisão:

1. Confirmar que a instância é proprietária de um player suportado/ativo e que a camada aplicável está habilitada.
2. Ignorar `isComposing` e situações de edição. Inspecionar `event.composedPath()` para encontrar inputs, textarea, select, contenteditable e controles dentro de Shadow DOM.
3. Respeitar botões, links e controles focados: Espaço/Enter pertencem à interação normal desses controles. Não deixar um botão “Aprendida” também pausar o vídeo.
4. Avaliar o caso exato de `Ctrl+C` ou `Meta+C`, sem Alt/Shift adicionais, antes da regra geral que rejeita modificadores.
5. Para os demais comandos, rejeitar Ctrl/Meta/Alt e reconhecer letras por `event.key.toLowerCase()`. Aceitar maiúsculas; Espaço é identificado explicitamente.
6. Decidir se a ação pode ser assumida. Só então chamar `preventDefault()` e impedir o processamento duplicado pertinente, usando `stopImmediatePropagation()` quando necessário no listener central.
7. Em `event.repeat`, não repetir a ação. Se for uma tecla já assumida pelo player/instância, suprimir também o evento repetido para o navegador não rolar a página nem o player executar comandos adicionais.

Se não há alvo de navegação, legenda ou capacidade aplicável, não consumir teclas de outras partes da página indiscriminadamente. Botões desabilitados/feedback local podem explicar a indisponibilidade. Uma falha assíncrona depois de uma tecla assumida não deve disparar um segundo fallback nativo.

Preservar os atalhos existentes de abrir biblioteca e fechar cartão. Conferir que o listener antigo de `A` foi removido, não apenas acrescentar um novo por cima. Confirmar na plataforma real que não há ação dupla; a ordem de listeners de terceiros pode exigir ajustes no ponto de instalação, sem simular teclas.

### 9.2 Salvar a fala com R

No keydown, obter um snapshot da fala de estudo. Se não existe texto, mostrar feedback discreto e não criar um registro vazio. Converter o snapshot em `SavedPhraseV2` com `kind: "sentence"` e enviar ao serviço de persistência.

Usar a tradução já pronta e correspondente àquele snapshot, se houver. **Não esperar tradução de rede para salvar a fala.** Se ela não estiver disponível, salvar apenas o original. Não usar tradução residual da fala anterior e não disparar nova tradução só por pressionar R.

Preservar as quebras de linha da legenda completa. Não salvar somente a palavra selecionada, um trecho do DOM ou o texto da tradução. A ação funciona quando o vídeo está pausado e quando a fala está retida pela pausa automática.

Enquanto aguarda, indicar “Salvando fala…”. Após confirmação, “Fala salva” ou “Fala já salva”. Em erro, “Não foi possível salvar. Tente novamente.” A deduplicação garante que duas pressões não criem cópias. Ignorar resultados visuais atrasados de sessões anteriores, mas não desfazer um salvamento válido que foi solicitado antes da troca de episódio.

### 9.3 Copiar com Ctrl/Cmd+C

Copiar somente o original completo da fala de estudo. Não incluir tradução, título, nome da plataforma, aspas extras ou metadados. Capturar o texto sincronicamente no evento do usuário e iniciar a chamada ao clipboard nesse mesmo gesto, antes de aguardar rede/storage.

Se há seleção não vazia de texto na página, no cartão, em input ou no Shadow DOM acessível, conservar a cópia nativa dessa seleção. Em campos de edição, conservar sempre o comportamento nativo. Se não há fala de estudo, não substituir o clipboard por texto vazio.

Usar `navigator.clipboard.writeText()` quando disponível no contexto e tratar rejeições. Mostrar “Copiado” somente no sucesso. Não ler o clipboard, não acrescentar `clipboardRead` e não pedir permissões amplas. Se a escrita não for permitida no frame/contexto, mostrar o original em campo selecionável com instrução para cópia normal; esse campo recebe o atalho nativo, sem nova interceptação.

Adicionar “Copiar fala” e “Salvar fala” como ações acessíveis no painel/cartão de controles da fala, reaproveitando exatamente os mesmos handlers dos atalhos. Isso também oferece uma saída quando um navegador reserva determinada combinação de teclas.

## 10. Biblioteca, HTML5 e ciclo de vida

### 10.1 Biblioteca de estudo

Preservar a biblioteca existente e organizar três vistas simples:

| Vista | Fonte de dados | Conteúdo |
|---|---|---|
| Frases salvas | `phrases` | Frases completas salvas por R e palavras com frase salvas pelo cartão. |
| Palavras difíceis | `vocabulary.languages[*].marks === difficult` | Somente palavras marcadas pessoalmente como difíceis, em vermelho. |
| Palavras aprendidas | `vocabulary.languages[*].marks === learned` | Palavras marcadas pessoalmente como aprendidas, em verde. |

A vista “Palavras difíceis” é o lugar único pedido para revisar as dificuldades, acessível pelo painel e pelo popup, mesmo sem vídeo aberto. Pode usar `library.html?tab=difficult` para abrir direto na vista. A lista especial não deve ocupar essa vista automaticamente.

Cada palavra aparece uma vez por idioma, com a forma, o idioma, a marca e os detalhes disponíveis. Mostrar a frase de contexto e tradução se foram salvas, sem placeholder fingindo que toda palavra tem definição. Marcas legadas sem contexto continuam utilizáveis.

Permitir buscar por palavra e contexto, filtrar idioma e ordenar por atualização mais recente; datas desconhecidas ficam ao final, com desempate alfabético. Conservar os filtros existentes de plataforma nas frases. Contadores refletem a vista/filtro atual e não contam duas vezes uma palavra por existir em várias frases.

Na vista de difíceis, “Marcar como aprendida” muda a marca e move o item para aprendidas. “Remover marcação” tira o item da lista sem apagar frases. Fazer o inverso em aprendidas quando o usuário escolher difícil. Todas as ações usam o serviço central e esperam confirmação.

Excluir uma frase apaga só aquela frase. O botão existente de limpar frases deve dizer claramente “Apagar todas as frases” e conservar sua confirmação; não pode limpar vocabulário nem configurações. Não acrescentar um botão de reset global de todos os dados como efeito lateral desta tarefa.

Atualizar listas abertas por `storage.onChanged` sem precisar recarregar a página, preservando busca, filtro e foco sempre que possível. Não iniciar traduções em massa ao abrir a biblioteca; mostrar os dados que já existem. O estado vazio de difíceis explica: “Clique com o botão direito em uma palavra da legenda para salvá-la aqui.”

### 10.2 HTML5 / Cinetaro

A arquitetura atual tem dois caminhos de legenda. Não considerar a tarefa concluída pintando apenas Netflix/Max: reutilizar o resolvedor de cores e o renderizador interativo também na camada `timed-subtitles.ts`.

Extrair a criação de tokens, aplicação de classes e tratamento de cliques para código que receba o contêiner/root e callbacks. Não usar seletores globais `document.querySelectorAll('.sf-word')` para alterar palavras de outra instância. O Shadow DOM precisa conter seus próprios estilos e cartão/controles acessíveis.

O host HTML5 atual usa `pointer-events: none`; habilitar eventos apenas nos elementos interativos de legendas/cartão, preservando o clique no player fora deles. Não montar um segundo overlay Netflix/Max por cima da camada HTML5.

Usar o idioma efetivo do seletor/fonte HTML5. O seletor atual admite inglês e português; mapear português para a mesma chave pessoal `pt-BR` usada no restante da extensão e inglês para `en`. Não tentar inferir idioma pelo texto. Português não recebe especiais. O modo HTML5 continua opt-in; seu toggle de tradução da frase não é ligado automaticamente por settings de outro caminho.

Ao clicar explicitamente numa palavra, permitir sua consulta conforme o idioma, sem ativar a tradução automática de todas as falas. Usar os tempos e o offset do controlador existente para contexto, navegação e pausa. Mudança de arquivo/fonte/offset invalida cálculos temporais pendentes e reconcilia a fala atual; mudança de offset não apaga vocabulário.

Manter importação local UTF-8 até 2 MB, descarte do arquivo em nova sessão, restauração dos modos nativos de TextTrack e tratamento de resultados atrasados. Não buscar legendas remotas nem baixar mídia.

### 10.3 Frames e foco

Conservar uma única instância proprietária conforme a coordenação existente. Somente o proprietário instala UI, observadores e controlador de player. Ao perder lease/propriedade, fazer cleanup completo antes de outra instância assumir.

Atalhos funcionam no documento que recebe o foco do player. Em iframe, o usuário precisa estar com o foco no player/frame ou nos controles da extensão correspondentes. Não prometer captura global de teclado de outros frames. Ao hospedar o overlay num documento acessível diferente, instalar/remover listeners no documento correto, incluindo seleção e fullscreen.

Preservar a allowlist explícita de hosts e o frame conhecido `https://cinextream.cc`. Não ampliar permissões por wildcard. O relay de sessão continua transportando somente IDs opacos, sem texto de legenda ou URLs de episódio. Mensagens locais de persistência ao worker são um protocolo separado, validado para os contextos autorizados; não encaminhar esse payload para outras páginas/frames.

Em fullscreen nativo do elemento `<video>`, a camada HTML5 atual não pode ser exibida. Conservar essa limitação visível e suspender ações dependentes de uma legenda invisível, incluindo pausa automática, R e cópia. Não esconder legendas nativas quando a camada não consegue substituí-las. Fullscreen do contêiner permanece o caminho esperado para estudar com overlay.

### 10.4 Cleanup e erros

Em `pagehide`, reinjeção, mudança de rota/vídeo, fonte e troca de proprietário: remover listeners, observadores, callbacks de animação, timers e referências do cartão. Invalidar gerações das operações. Em `pageshow`, reconstruir uma única instância; nunca somar listeners por retorno do cache de navegação.

Uma atualização de cores deve mudar classes dos tokens existentes quando possível, sem reconstruir a linha inteira e perder seleção/foco. Todas as novas raízes DOM injetadas precisam de `data-streamfluent`, seguindo os helpers atuais, para não retroalimentar o MutationObserver.

Falhas de tradução não bloqueiam marcação, cópia, navegação nem salvamento do original. Falhas de storage não devem ser mostradas como sucesso. Falhas de player não devem provocar downloads, alteração de DRM, busca de APIs alternativas sem validação ou mudanças de permissões.

## 11. Blocos de implementação e commits

Cada bloco termina em um commit real, com seu diff e verificações revisados. Execute os testes direcionados que comprovem os comportamentos afetados e `npm run typecheck`. Execute `npm run build` quando o bloco alterar entradas, imports, assets ou páginas públicas. A suíte completa é obrigatória na base e no fechamento; não repetir testes sem necessidade apenas para aumentar a lista de verificações.

Antes do bloco 1, registre `git status`, commit base e resultado inicial de `npm run typecheck`, `npm test` e `npm run build`. Se faltarem dependências, use o gerenciador/lockfile atual sem atualizar pacotes desnecessariamente. Falhas pré-existentes devem ser distinguidas de regressões introduzidas.

### Bloco 1 — schema, migração e gravação coordenada

**Objetivo:** tornar marcas, frases e preferências confiáveis antes de acrescentar novas interações.

**Arquivos principais:** `types.ts`, `settings.ts`, `storage.ts`, `vocabulary.ts`, `background.ts`; novos helpers de normalização, mensagens e persistência; adaptação mínima dos consumidores `content.ts`, `popup.js`, `library.js` e overlay ao novo contrato.

Implementar a seção 4: schema V2, conversão `marked → learned`, frases `word/sentence`, novos defaults, worker como único gravador, respostas após persistência, revisão e tratamento de erro. Os consumidores existentes precisam continuar funcionando ao fim do bloco; não deixar o popup ou a biblioteca lendo o envelope novo como se fosse o mapa antigo.

Criar/estender testes para migração repetida, colisões normalizadas, duas abas marcando palavras diferentes, mudança concorrente na mesma palavra, falha de gravação, reinício do serviço e preservação de settings. Verificar que uma falha não bloqueia a fila seguinte e que operações de remoção não ressuscitam por merge de snapshot antigo.

**Aceite:** dados atuais são lidos sem perda; uma marca confirmada sobrevive à recriação do store; nenhum writer antigo permanece para as chaves migradas; a biblioteca antiga ainda abre durante a transição.

**Commit:** `feat(storage): migrate study data and serialize local writes`

### Bloco 2 — lista de 100 palavras e regras de cor

**Objetivo:** entregar a classificação especial local, o toggle e o novo significado das cores.

**Arquivos principais:** novo `src/data/special-words.en.json`, `special-words.ts`, `word-status.ts`; `vocabulary.ts`, overlay e controles de settings/popup. Incluir uma nota de fontes em `docs/special-words-sources.md` extraída da seção 13.

Implementar o resolvedor único, novos campos nos controles, registro de primeira aparição e `freshKeys` por ocorrência. Aplicar verde em aprendidas e remover referências visuais a amarelo/Mark. Especial começa desligado, respeita idioma e nunca é gravado como marca pessoal.

Testar combinações que possam produzir conflito: especial + nova; especial + aprendida; especial + difícil; toggle desligado; idioma português; palavra repetida dentro da primeira fala; replay; renderização após chegada tardia de storage/tradução. Validar unicidade e quantidade do conjunto de 100 sem consultar a rede nos testes/build.

**Aceite:** as cinco situações visuais da seção 2.3 são reproduzíveis; desativar especiais só remove o lilás; todas as entradas vêm do anexo e não de uma nova seleção inventada durante a implementação.

**Commit:** `feat(vocabulary): add special word list and learned colors`

### Bloco 3 — mouse e cartão de palavra

**Objetivo:** clique direito salva dificuldade; clique esquerdo oferece consulta e marcação.

**Arquivos principais:** overlay, `content.ts`, renderizador de palavras compartilhável e testes de overlay.

Implementar a seção 6, incluindo contexto capturado antes de awaits, idempotência, retorno de erro, botões de marcação disponíveis offline e correção do falso sucesso do botão de salvar. Refatorar consultas globais de palavras para o root da instância. Manter arraste, seleção e fechamento do cartão.

Testar clique direito sem requisição de tradução, clique direito repetido, aprendida → difícil, esquerdo sem marca automática, remoção de marca, erro de gravação e falha antiga após escolha mais recente. Testar também arraste acima/abaixo de 4 px e menu de contexto fora da legenda.

**Aceite:** um clique direito resulta em uma única marca persistida vermelha; clicar à esquerda nunca altera status sozinho; feedback “salvo” só aparece após confirmação.

**Commit:** `feat(subtitles): add quick difficult marking and word actions`

### Bloco 4 — biblioteca de difíceis, aprendidas e frases

**Objetivo:** tornar as marcações consultáveis fora do player e suportar frases completas.

**Arquivos principais:** `public/library.html`, `public/library.js`, popup/links do painel e repositórios de leitura.

Implementar a seção 10.1: vistas, busca, filtros, contadores, ações de mudança de marca, registros legados, atualização ao vivo e deep link para difíceis. Adaptar renderização e busca para `kind: sentence` sem acessar `selectedWord` inexistente.

Verificar integração entre marca no player e biblioteca aberta; mover difícil → aprendida e remover marca; excluir frase sem apagar palavra; limpar frases sem apagar vocabulário; duplicatas por idioma e dados legados sem tradução/contexto. Renderizar textos potencialmente contendo HTML como texto literal.

**Aceite:** “Palavras difíceis” contém somente marcas pessoais vermelhas, sem especiais automáticas, repetições por episódio ou dependência de um player aberto.

**Commit:** `feat(library): add difficult and learned word views`

### Bloco 5 — comandos do player e navegação

**Objetivo:** implementar ações A/S/D/Espaço reaproveitáveis e seguras para cada adaptador.

**Arquivos principais:** `line-navigation.ts`, `line-timeline.ts`, `playback-controller.ts`, tipos, adaptadores, `netflix-bridge.ts` e `netflix-main.ts`.

Separar ação de navegação de instalação de teclado, preservando temporariamente a integração existente de A até o bloco 6 assumir seu listener. Implementar repetir, avançar cinco segundos e alternar reprodução, incluindo fila de comandos, alvo pendente, limites de seek, sessão e resultado de operação. Criar o contexto de estudo necessário ao controlador.

Estender testes de timeline/navegação/ponte com D simples e duplo, fim de vídeo, NaN/Infinity, seek recusado, resposta atrasada, A em silêncio/trecho não assistido, S pausado e play rejeitado. O teste Netflix deve comprovar que falha de ponte não escreve `currentTime`.

**Aceite:** A mantém seus casos atuais; S faz seek + play uma vez; D usa exatamente +5 s e conserva estado; Space alterna uma vez; comandos antigos não atingem nova sessão.

**Commit:** `feat(player): add repeat five-second seek and playback controls`

### Bloco 6 — teclado central, salvar fala e copiar

**Objetivo:** ligar as ações às teclas e disponibilizar R/cópia sem interferir em edição normal.

**Arquivos principais:** `keyboard-shortcuts.ts`, `study-context.ts`, `content.ts`, overlay/controles e persistência de frases.

Implementar a seção 9. Substituir definitivamente o listener legado de A pelo roteador central. Conectar Q à preferência; a reação de pausa será concluída no bloco 7. Ligar R ao salvamento de snapshot, Ctrl/Cmd+C à cópia e oferecer os botões equivalentes.

Testar modificadores, Caps/maiúsculas, repetição, composição IME, input, textarea, select, contenteditable e controles em Shadow DOM. Testar seleção normal de texto, cópia sem legenda, clipboard rejeitado, R sem tradução, duplicata, falha de storage e troca de fala durante salvamento.

**Aceite:** cada tecla chama uma ação; digitar letras em campos continua normal; Ctrl/Cmd+C preserva seleção; R salva uma frase completa sem palavra fictícia e sem esperar rede.

**Commit:** `feat(shortcuts): wire study controls sentence saving and copy`

### Bloco 7 — pausa automática e fala retida

**Objetivo:** pausar ao fim das falas e manter um contexto estável para estudar.

**Arquivos principais:** `auto-pause.ts`, contexto de estudo, controlador de reprodução, `content.ts`, timeline e controles visuais.

Implementar a seção 8 com interfaces que recebam tanto tempos reais quanto transições de DOM. Integrar ao caminho Netflix/Max. O caminho temporal deve ficar pronto e testado para a integração HTML5 do bloco seguinte. Conectar estado ao controle já exposto por Q/painel.

Testar fim real, offset positivo/negativo, fala seguinte contígua, sobreposição, desaparecimento DOM, troca direta de texto, silêncio, buffering, seek, velocidade alterada, pause recusado, repetição com S e retomada sem ciclo de pausas. Confirmar que desligar Q não dá play.

**Aceite:** pausa no máximo uma vez por término/passagem; fala retida corresponde à que terminou; copiar/R funcionam sobre ela; seeks e troca de episódio não geram pausa indevida.

**Commit:** `feat(player): add subtitle auto-pause and retained study context`

### Bloco 8 — paridade HTML5, Shadow DOM e frames

**Objetivo:** levar palavras, comandos e pausa automática ao segundo caminho de legendas, respeitando seu modelo opt-in.

**Arquivos principais:** `ui/timed-subtitles.ts`, `subtitles.ts`, `html5-player.ts`, `cinetaro-session.ts`, renderizador compartilhado e fixture `player-test`.

Implementar a seção 10.2–10.3. Reaproveitar controladores em vez de duplicar suas regras. Ajustar eventos e estilos dentro do Shadow DOM, foco do documento correto, acesso a palavras e lifecycle do proprietário. Preservar idioma/fonte/offset, restauração nativa e tradução opt-in.

Testar uma única UI e um único listener após troca de dono, desmontagem de frame, reinjeção e volta por pageshow. Testar nova fonte/arquivo durante consulta pendente, cores em português/inglês, fullscreen do contêiner e suspensão no fullscreen do vídeo.

**Aceite:** o HTML5 habilitado oferece os mesmos estados e ações; desabilitá-lo restaura o comportamento nativo e remove seus handlers; não há novos hosts nem legendas circulando no relay de sessão.

**Commit:** `feat(html5): integrate study interactions and playback controls`

### Bloco 9 — regressões de integração e robustez

**Objetivo:** comprovar que os blocos funcionam juntos e corrigir falhas que aparecem entre módulos.

**Arquivos principais:** testes e fixtures existentes/novos; ajustes pontuais nos módulos envolvidos.

Executar a matriz da seção 12. Acrescentar testes de integração significativos para os fluxos combinados, sobretudo especial → difícil → aprendida → sem marca, duas abas + biblioteca, migração + primeiro cue, pausa + R/cópia e troca de sessão com operações pendentes. Não criar testes que apenas repetem constantes sem exercitar o comportamento.

Revisar listeners duplicados, resultados fora de ordem, leitura de dados não validados, paths de escrita antigos e consultas DOM globais. Corrigir regressões do escopo. Registrar limitações verificadas sem inventar resultados de teste em Netflix/Max.

**Aceite:** fluxos combinados passam nos testes automatizados e na fixture; nenhum defeito conhecido do escopo é escondido como “melhoria futura”.

**Commit:** `test(study): cover persistence playback and subtitle integration`

### Bloco 10 — documentação, build e fechamento

**Objetivo:** entregar o conjunto pronto para revisão e carregamento da extensão.

**Arquivos principais:** `README.md`, `AGENTS.md`, documentação de fontes e progresso; scripts/configuração somente se um ajuste real for necessário.

Atualizar atalhos, cores, cliques, defaults e localização das difíceis. Corrigir no AGENTS.md as descrições antigas de Mark/amarelo, writers distribuídos, ausência de cores no HTML5 e capacidades da ponte que tenham mudado. Descrever a pausa DOM como aproximada e a lista especial como seleção fixa de palavras confirmadas em dicionário, sem prometer nível CEFR uniforme.

Rodar `npm run typecheck`, `npm test` e `npm run build`. Inspecionar o resultado de build: bundle contém a lista local, páginas públicas usam o protocolo atual e permissões continuam restritas. Não adicionar artefatos de `dist/` ao Git se a política atual do repositório os ignora.

Quando houver sessão de teste disponível e autorizada, validar os controles nos players reais; caso contrário, registrar explicitamente “não verificado em player real” e separar isso dos testes da fixture. Se uma plataforma real testada falhar num requisito central, corrigir antes de considerá-la pronta; não declarar compatibilidade a partir de mocks.

**Aceite:** gates finais aprovados, documentação consistente e instruções de teste reais. Na entrega, listar os dez commits com hashes, testes executados e limitações remanescentes de ambiente/plataforma.

**Commit:** `docs(study): document controls colors sources and validation`

## 12. Matriz mínima de aceite

| ID | Cenário | Resultado esperado |
|---|---|---|
| C01 | Instalação nova | Novas ligado; especiais e pausa automática desligados. |
| C02 | Perfil antigo com difícil/amarelo | Difícil preservado; amarelo convertido em verde; frases e settings preservados. |
| C03 | Primeira fala chega antes do storage | Processada ao inicializar sem classificar falsamente todo o histórico como novo. |
| C04 | Nova palavra repetida na primeira fala | Todas as aparições dessa palavra na ocorrência recebem azul. |
| C05 | Mesma fala retorna depois | A palavra já vista não recebe azul novamente. |
| C06 | Palavra especial com toggle desligado/ligado | Segue normal/azul quando desligado; lilás quando ligado, salvo marca pessoal. |
| C07 | Especial → difícil → aprendida → remover | Lilás → vermelho → verde → lilás, sem duplicar registros. |
| C08 | Lista especial aplicada a português | Nenhuma marca lilás por coincidência de grafia. |
| M01 | Clique direito sem internet | Marca difícil persistida; nenhuma consulta disparada por essa ação. |
| M02 | Dois cliques direitos na mesma palavra | Uma marca; segundo clique não remove nem duplica. |
| M03 | Clique esquerdo e tradução falha | Cartão permanece útil e permite marcar/salvar original. |
| M04 | Arraste da legenda | Não abre cartão nem marca palavra ao soltar. |
| M05 | Clique direito fora de palavra válida | Menu nativo preservado. |
| P01 | Duas abas marcam palavras diferentes ao mesmo tempo | As duas alterações permanecem no storage. |
| P02 | Escolhas sucessivas na mesma palavra com resposta antiga | A última operação confirmada determina a marca; erro antigo não a reverte. |
| P03 | Falha de storage/quota | Não mostra salvo, não apaga dados e permite tentar novamente. |
| P04 | Reiniciar aba/worker depois de salvar | Marca/frase confirmada reaparece sem depender de cache. |
| L01 | Difíceis aberta enquanto o player marca | Item aparece sem reload e sem duplicata. |
| L02 | Excluir frase ou limpar frases | Marca pessoal continua existindo. |
| L03 | Remover marca ou passar a aprendida | Frases salvas continuam existindo. |
| K01 | Digitar A/S/D/Q/R num campo | Digitação normal, nenhum comando de estudo. |
| K02 | Espaço num botão de cartão focado | Executa o botão, não alterna o vídeo junto. |
| K03 | Segurar uma tecla | Sem repetição involuntária de ações/scroll. |
| K04 | Ctrl/Cmd+C com seleção | Copia a seleção nativamente. |
| K05 | Ctrl/Cmd+C sem seleção e com fala | Copia apenas o original completo. |
| K06 | R durante mudança de legenda | Salva exatamente o snapshot capturado no keydown. |
| V01 | D em 120 s, uma pressão | Destino 125 s, preservado o estado de reprodução. |
| V02 | D em 120 s, duas pressões rápidas | Destino final 130 s; callback antigo não o desfaz. |
| V03 | D próximo do fim | Alvo limitado à mídia/janela válida. |
| V04 | A em fala/silêncio/trecho não assistido | Mantém os comportamentos existentes da timeline. |
| V05 | S com vídeo pausado | Seek para o início seguro da fala e play uma vez. |
| V06 | Ponte Netflix indisponível | Falha controlada e nenhuma escrita direta em currentTime. |
| A01 | Auto-pause em fim temporal conhecido | Uma pausa no término com offset aplicado. |
| A02 | Auto-pause em substituição DOM | Pausa aproximada e retenção da fala anterior. |
| A03 | Retomar após pausa automática | Não pausa de novo na mesma fronteira. |
| A04 | S repete a fala com auto-pause ligado | Nova passagem pode pausar novamente no fim. |
| A05 | D/seek/troca de episódio durante modo ligado | Sem pausa por eventos da posição/sessão anterior. |
| A06 | Q desliga enquanto pausado | Continua pausado; preferência desliga. |
| H01 | HTML5 habilitado com fonte válida | Palavras, cartão, cores, atalhos e pausa integrados. |
| H02 | HTML5 desabilitado/frame perde propriedade | Restaura tracks e remove UI/listeners daquele proprietário. |
| H03 | Fullscreen nativo do vídeo | Sem ocultar legenda nativa ou acionar pausa de uma camada invisível. |
| S01 | Texto de legenda/metadados contém HTML | Renderizado como texto, sem execução/injeção. |
| S02 | Inspeção de rede | Sem calls para Linglify/Oxford, telemetria ou envio da biblioteca. |

Os testes de lógica e fixtures cobrem regras próprias da extensão. A observação no player real verifica integração com APIs e handlers de terceiros. Não confundir esses dois tipos de evidência.

## 13. Conjunto inicial de palavras especiais e fontes

O conjunto abaixo contém **100 palavras selecionadas das tabelas do artigo indicado pelo usuário**, com verbetes confirmados individualmente no **Oxford Advanced Learner’s Dictionary**. Não é um ranking oficial das “100 mais difíceis”. A seleção reúne vocabulário acadêmico, literário, técnico e formas difíceis do artigo.

Fontes consultadas:

- [Linglify — palavras difíceis em inglês](https://linglify.com/pt-BR/learn/en/blog/hard-english-words): origem dos candidatos.
- [Oxford Learner’s Dictionaries](https://www.oxfordlearnersdictionaries.com/): confirmação lexical pelos 100 links individuais abaixo.
- [Oxford 3000 e 5000 — explicação das listas](https://www.oxfordlearnersdictionaries.com/about/wordlists/oxford3000-5000).
- [The Oxford 5000 — PDF oficial das 2.000 entradas adicionais](https://www.oxfordlearnersdictionaries.com/external/pdf/wordlists/oxford-3000-5000/The_Oxford_5000.pdf).

**“Existe na Oxford” e “pertence à Oxford 5000” não são a mesma afirmação.** Todas as 100 foram confirmadas no dicionário; 25 também foram encontradas no PDF das entradas adicionais da Oxford 5000 e recebem metadados de nível/página abaixo. Ausência desse campo nas outras 75 significa apenas que este arquivo não lhes atribui essa confirmação adicional ou nível CEFR. Não significa ausência no dicionário, nem autoriza inferir C1/C2.

A dificuldade não é calculada em execução. O produto chama o recurso de “Palavras especiais” e utiliza este conjunto fixo quando o usuário liga o botão. Não reproduzir definições, exemplos ou pronúncias das fontes no dataset: os links servem à procedência e o cartão mantém os provedores já existentes.

O JSON é o payload canônico a extrair para `src/data/special-words.en.json`. `oxford5000Additional` é metadado documental, sem efeito na cor e sem interface de níveis. A ordenação é alfabética, não por dificuldade. Não substituir palavras para completar a contagem: ela já está fechada e verificada.

```json
{
  "schemaVersion": 1,
  "listId": "linglify-oxford-special-en-100-v1",
  "language": "en",
  "verifiedOn": "2026-10-17",
  "count": 100,
  "sourceUrl": "https://linglify.com/pt-BR/learn/en/blog/hard-english-words",
  "oxford5000AdditionalSourceUrl": "https://www.oxfordlearnersdictionaries.com/external/pdf/wordlists/oxford-3000-5000/The_Oxford_5000.pdf",
  "entries": [
    {"word": "accommodate", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/accommodate", "oxford5000Additional": {"level": "B2", "page": 1}},
    {"word": "acquaintance", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/acquaintance"},
    {"word": "acquit", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/acquit"},
    {"word": "adverse", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/adverse", "oxford5000Additional": {"level": "C1", "page": 1}},
    {"word": "algorithm", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/algorithm", "oxford5000Additional": {"level": "C1", "page": 1}},
    {"word": "ambiguous", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/ambiguous"},
    {"word": "ameliorate", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/ameliorate"},
    {"word": "amendment", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/amendment", "oxford5000Additional": {"level": "C1", "page": 1}},
    {"word": "anachronism", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/anachronism"},
    {"word": "anomaly", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/anomaly"},
    {"word": "antithesis", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/antithesis"},
    {"word": "arbitrary", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/arbitrary"},
    {"word": "bellicose", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/bellicose"},
    {"word": "bureaucracy", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/bureaucracy"},
    {"word": "capricious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/capricious"},
    {"word": "catharsis", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/catharsis"},
    {"word": "cognizant", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/cognizant"},
    {"word": "collateral", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/collateral_1"},
    {"word": "colonel", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/colonel"},
    {"word": "conflagration", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/conflagration"},
    {"word": "conscience", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/conscience", "oxford5000Additional": {"level": "C1", "page": 2}},
    {"word": "consensus", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/consensus", "oxford5000Additional": {"level": "C1", "page": 2}},
    {"word": "conundrum", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/conundrum"},
    {"word": "credible", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/credible", "oxford5000Additional": {"level": "C1", "page": 2}},
    {"word": "debris", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/debris", "oxford5000Additional": {"level": "C1", "page": 2}},
    {"word": "deleterious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/deleterious"},
    {"word": "depreciation", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/depreciation"},
    {"word": "deteriorate", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/deteriorate", "oxford5000Additional": {"level": "C1", "page": 3}},
    {"word": "dichotomy", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/dichotomy"},
    {"word": "dilemma", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/dilemma", "oxford5000Additional": {"level": "C1", "page": 3}},
    {"word": "discrete", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/discrete"},
    {"word": "disinterested", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/disinterested"},
    {"word": "dividend", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/dividend", "oxford5000Additional": {"level": "C1", "page": 3}},
    {"word": "ebullient", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/ebullient"},
    {"word": "elicit", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/elicit"},
    {"word": "eloquent", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/eloquent"},
    {"word": "empirical", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/empirical"},
    {"word": "enigma", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/enigma"},
    {"word": "ephemeral", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/ephemeral"},
    {"word": "esoteric", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/esoteric"},
    {"word": "exacerbate", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/exacerbate"},
    {"word": "exaggerate", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/exaggerate", "oxford5000Additional": {"level": "C1", "page": 3}},
    {"word": "fastidious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/fastidious"},
    {"word": "fiduciary", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/fiduciary_1"},
    {"word": "gregarious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/gregarious"},
    {"word": "hegemony", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/hegemony"},
    {"word": "hierarchy", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/hierarchy", "oxford5000Additional": {"level": "C1", "page": 4}},
    {"word": "hypothesis", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/hypothesis", "oxford5000Additional": {"level": "B2", "page": 4}},
    {"word": "idiosyncratic", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/idiosyncratic"},
    {"word": "impetuous", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/impetuous"},
    {"word": "ineffable", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/ineffable"},
    {"word": "inevitable", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/inevitable", "oxford5000Additional": {"level": "B2", "page": 4}},
    {"word": "irresistible", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/irresistible"},
    {"word": "jurisdiction", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/jurisdiction", "oxford5000Additional": {"level": "C1", "page": 4}},
    {"word": "juxtaposition", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/juxtaposition"},
    {"word": "laconic", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/laconic"},
    {"word": "legislation", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/legislation", "oxford5000Additional": {"level": "C1", "page": 4}},
    {"word": "loquacious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/loquacious"},
    {"word": "lugubrious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/lugubrious"},
    {"word": "magnanimous", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/magnanimous"},
    {"word": "maintenance", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/maintenance", "oxford5000Additional": {"level": "C1", "page": 5}},
    {"word": "mendacious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/mendacious"},
    {"word": "mischievous", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/mischievous"},
    {"word": "nebulous", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/nebulous"},
    {"word": "nonchalant", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/nonchalant"},
    {"word": "obfuscate", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/obfuscate"},
    {"word": "obsequious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/obsequious"},
    {"word": "occurrence", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/occurrence", "oxford5000Additional": {"level": "C1", "page": 5}},
    {"word": "paradigm", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/paradigm"},
    {"word": "paradox", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/paradox"},
    {"word": "pathogen", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/pathogen"},
    {"word": "perfunctory", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/perfunctory"},
    {"word": "perseverance", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/perseverance"},
    {"word": "pragmatic", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/pragmatic"},
    {"word": "precarious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/precarious"},
    {"word": "precedent", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/precedent", "oxford5000Additional": {"level": "C1", "page": 5}},
    {"word": "privilege", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/privilege_1", "oxford5000Additional": {"level": "C1", "page": 6}},
    {"word": "prognosis", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/prognosis"},
    {"word": "prolific", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/prolific"},
    {"word": "quagmire", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/quagmire"},
    {"word": "quintessential", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/quintessential"},
    {"word": "recalcitrant", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/recalcitrant"},
    {"word": "resilient", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/resilient"},
    {"word": "reticent", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/reticent"},
    {"word": "rhetoric", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/rhetoric", "oxford5000Additional": {"level": "C1", "page": 6}},
    {"word": "sanguine", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/sanguine"},
    {"word": "scrutinize", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/scrutinize"},
    {"word": "soliloquy", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/soliloquy"},
    {"word": "subpoena", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/subpoena_1"},
    {"word": "surreptitious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/surreptitious"},
    {"word": "surveillance", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/surveillance", "oxford5000Additional": {"level": "C1", "page": 7}},
    {"word": "tenacious", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/tenacious"},
    {"word": "threshold", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/threshold", "oxford5000Additional": {"level": "C1", "page": 7}},
    {"word": "truculent", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/truculent"},
    {"word": "ubiquitous", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/ubiquitous"},
    {"word": "unanimous", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/unanimous"},
    {"word": "unprecedented", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/unprecedented", "oxford5000Additional": {"level": "C1", "page": 7}},
    {"word": "verbose", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/verbose"},
    {"word": "volatile", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/volatile"},
    {"word": "withhold", "oxfordUrl": "https://www.oxfordlearnersdictionaries.com/definition/english/withhold"}
  ]
}
```

## 14. Condição de conclusão para o agente

A tarefa termina quando os dez blocos estiverem implementados, verificados e commitados, com a biblioteca e os dois caminhos de legendas usando os mesmos estados e regras. Entregue os hashes dos commits, os resultados dos gates e uma indicação objetiva do que foi ou não observado em players reais.

Não substituir esta especificação por outra rodada de planejamento. Não considerar o trabalho pronto com apenas botões desenhados, cores sem persistência, atalhos sem integração nos caminhos reais do código ou uma lista de palavras ainda a pesquisar. Os dados e as decisões necessários à implementação estão definidos neste arquivo.

