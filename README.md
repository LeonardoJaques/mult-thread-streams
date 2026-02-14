# 🧵 Multithreading & Streams — CSV Processor

Processador de arquivos CSV no **front-end** usando **Web Workers** (multi-threading) e **Streams API**, demonstrando como distribuir trabalho pesado entre múltiplas threads sem bloquear a interface do usuário.

> Baseado em [Erick Wendel](https://www.youtube.com/@ErickWendelTraining)

---

## 📐 Arquitetura

O projeto segue o padrão **MVC** com separação clara de responsabilidades:

```mermaid
graph TB
    subgraph "Main Thread (UI)"
        INDEX[index.js<br/>Bootstrap]
        VIEW[View<br/>DOM manipulation]
        CTRL[Controller<br/>Orchestration]
    end

    subgraph "Worker Threads"
        W1[Worker 1<br/>Service + Stream]
        W2[Worker 2<br/>Service + Stream]
        W3[Worker 3<br/>Service + Stream]
        W4[Worker N...<br/>Service + Stream]
    end

    subgraph "Streams Pipeline (inside each Worker)"
        direction LR
        S1["File.stream()"] --> S2["TextDecoderStream"]
        S2 --> S3["TransformStream<br/>(CSV → JSON)"]
        S3 --> S4["WritableStream<br/>(Find Occurrences)"]
    end

    INDEX --> VIEW
    INDEX --> CTRL
    CTRL -->|"postMessage(query, file)"| W1
    CTRL -->|"postMessage(query, file)"| W2
    CTRL -->|"postMessage(query, file)"| W3
    CTRL -->|"postMessage(query, file)"| W4
    W1 -->|"onmessage(progress, results)"| CTRL
    W2 -->|"onmessage(progress, results)"| CTRL
    W3 -->|"onmessage(progress, results)"| CTRL
    W4 -->|"onmessage(progress, results)"| CTRL
    CTRL --> VIEW
```

| Arquivo | Responsabilidade |
|---|---|
| `index.js` | Bootstrap — instancia View, Service e inicializa o Controller |
| `controller.js` | Orquestra View ↔ Workers, distribui o arquivo, agrega resultados |
| `service.js` | Pipeline de Streams: `File → TextDecoder → CSV→JSON → FindOccurrences` |
| `view.js` | Manipulação do DOM (form, progress bar, debug log) |
| `worker.js` | Executa o Service em thread separada via Web Worker |

---

## 🔄 Como os Web Workers Funcionam

### O Problema: Single Thread

JavaScript no browser roda em uma **única thread** (a Main Thread). Se você processar um CSV de 1 milhão de linhas na Main Thread, a interface **congela** — o botão não responde, a progress bar trava, e o usuário pensa que a aplicação quebrou.

### A Solução: Web Workers

Web Workers permitem rodar código JavaScript em **threads separadas**, sem bloquear a UI. A comunicação entre a Main Thread e os Workers é feita via **message passing** (`postMessage` / `onmessage`).

```mermaid
sequenceDiagram
    participant User
    participant UI as Main Thread (UI)
    participant C as Controller
    participant W1 as Worker 1
    participant W2 as Worker 2
    participant W3 as Worker 3
    participant W4 as Worker 4
    participant W5 as Worker 5

    User->>UI: Seleciona CSV + clica "Search"
    UI->>C: onFormSubmit({description, file})
    
    Note over C: Lê o arquivo, separa header,<br/>divide as linhas em 5 partes

    par Distribuição paralela
        C->>W1: postMessage({query, chunk_1})
        C->>W2: postMessage({query, chunk_2})
        C->>W3: postMessage({query, chunk_3})
        C->>W4: postMessage({query, chunk_4})
        C->>W5: postMessage({query, chunk_5})
    end

    Note over W1,W5: Cada Worker processa seu<br/>chunk via Streams pipeline

    par Execução paralela
        W1-->>C: progress(25%)
        W2-->>C: progress(50%)
        W3-->>C: progress(75%)
        W1-->>C: onOcurrenceUpdate({found: 3})
        W4-->>C: progress(80%)
        W5-->>C: progress(100%)
    end

    W1-->>C: done({took: "0.5s", lines: 200000})
    W2-->>C: done({took: "0.6s", lines: 200000})
    W3-->>C: done({took: "0.5s", lines: 200000})
    W4-->>C: done({took: "0.7s", lines: 200000})
    W5-->>C: done({took: "0.4s", lines: 200000})

    Note over C: Agrega resultados de todos os workers

    C->>UI: updateDebugLog("✅ All 5 workers complete!")
    UI->>User: Exibe resultados + progress 100%
```

### Regras dos Web Workers

| Característica | Detalhe |
|---|---|
| **Isolamento** | Workers não acessam o DOM, `window`, ou `document` |
| **Comunicação** | Apenas via `postMessage()` / `onmessage` (dados serializados) |
| **Transferência** | Arquivos (`File`, `Blob`) podem ser transferidos sem cópia |
| **Ciclo de vida** | Criados com `new Worker()`, encerrados com `worker.terminate()` |
| **Módulos** | Suportam `type: "module"` para `import`/`export` (Chrome) |

---

## 🌊 Como os Streams Funcionam

Streams permitem processar dados **em pedaços (chunks)** conforme chegam, em vez de carregar tudo na memória.

```mermaid
graph LR
    subgraph "Pipeline de Streams"
        A["📄 File.stream()<br/>(ReadableStream)"] 
        B["🔤 TextDecoderStream<br/>(bytes → texto)"]
        C["🔄 TransformStream<br/>(CSV → JSON objects)"]
        D["📝 WritableStream<br/>(busca ocorrências)"]
    end
    A -->|pipeThrough| B
    B -->|pipeThrough| C
    C -->|pipeTo| D
```

**Cada chunk passa pela pipeline assim:**

```
Chunk de bytes → "SL2016,01/01/2016,VEHICLE THEFT,..." → {case: "SL2016", description: "VEHICLE THEFT"} → found["THEFT"]++
```

### Buffer de Linhas Cortadas

Quando um chunk chega, ele pode cortar uma linha no meio:

```
Chunk 1: "...THEFT,5XX S 900 E\nSL2016117,01/01/20"  ← linha cortada!
Chunk 2: "16,DOMESTIC/PHYSICAL..."                      ← continuação
```

O `TransformStream` usa um **buffer `remainder`** que guarda o pedaço incompleto e o prepende ao próximo chunk, garantindo integridade dos dados.

---

## 📊 Ganhos de Performance

### Single Thread vs Multi-Thread

```mermaid
gantt
    title Processamento de 1M linhas de CSV
    dateFormat ss
    axisFormat %S s

    section Single Thread
    Processar 1M linhas      :a1, 00, 10s

    section 5 Workers
    Worker 1 (200K linhas)   :b1, 00, 2s
    Worker 2 (200K linhas)   :b2, 00, 2s
    Worker 3 (200K linhas)   :b3, 00, 2s
    Worker 4 (200K linhas)   :b4, 00, 2s
    Worker 5 (200K linhas)   :b5, 00, 2s
```

| Métrica | 1 Thread | 5 Threads | Ganho |
|---|---|---|---|
| **UI responsiva?** | ❌ Congela | ✅ Sempre fluida | ∞ |
| **Tempo teórico** | T | ~T/N | ~5x mais rápido |
| **Uso de CPU** | 1 core | Até 5 cores | Melhor utilização |
| **Memória** | Streams minimizam | Streams em cada worker | Similar |

> ⚠️ Os ganhos reais dependem do número de cores da CPU e do overhead de criação/comunicação dos workers. Para arquivos pequenos, o overhead pode ser maior que o ganho.

---

## 🏢 Casos de Uso Reais

### 🛒 Black Friday — Validação de Catálogo em Massa

Um e-commerce se prepara para a **Black Friday**. O time de operações precisa validar o CSV de **500 mil produtos** antes de publicar: preços corretos, descontos aplicados, estoque disponível, categorias válidas.

```mermaid
graph LR
    subgraph "Upload do CSV de Produtos"
        CSV["catalogo_bf_2024.csv<br/>500K produtos"]
    end
    subgraph "5 Workers validando em paralelo"
        W1["Worker 1<br/>100K produtos<br/>Valida preços"]
        W2["Worker 2<br/>100K produtos<br/>Valida preços"]
        W3["Worker 3<br/>100K produtos<br/>Valida preços"]
        W4["Worker 4<br/>100K produtos<br/>Valida preços"]
        W5["Worker 5<br/>100K produtos<br/>Valida preços"]
    end
    subgraph "Resultado"
        R["✅ 498.230 OK<br/>❌ 1.770 com erro<br/>⏱ 3s em vez de 15s"]
    end
    CSV --> W1 & W2 & W3 & W4 & W5 --> R
```

**O cenário sem Workers:** o analista faz upload do CSV no painel admin, a tela congela por 15 segundos, ele não sabe se funcionou, clica de novo, e o processamento reinicia. Com Workers, a progress bar avança em tempo real e o resultado aparece em 3 segundos — crítico quando faltam horas para a virada da Black Friday.

---

### 🔄 Migração de Dados — De Sistema Legado para Novo

Uma empresa está migrando de um **ERP legado** para um novo sistema. O time de TI exportou a base de clientes em CSV: **2 milhões de registros** com nome, CPF, endereço, histórico de compras. Antes de importar, precisam validar e transformar os dados no front-end:

- CPFs inválidos ou duplicados
- Endereços incompletos
- Datas em formato errado (`DD/MM/YYYY` → `YYYY-MM-DD`)
- Campos obrigatórios vazios

```mermaid
sequenceDiagram
    participant Analista
    participant UI as Painel de Migração
    participant W1 as Worker 1 (400K)
    participant W2 as Worker 2 (400K)
    participant W3 as Worker 3 (400K)
    participant W4 as Worker 4 (400K)
    participant W5 as Worker 5 (400K)

    Analista->>UI: Upload clientes_legado.csv (2M linhas)
    UI->>UI: Divide arquivo em 5 partes

    par Validação paralela
        UI->>W1: Validar chunk 1
        UI->>W2: Validar chunk 2
        UI->>W3: Validar chunk 3
        UI->>W4: Validar chunk 4
        UI->>W5: Validar chunk 5
    end

    W1-->>UI: 12 CPFs inválidos, 3 datas erradas
    W2-->>UI: 8 CPFs inválidos, 1 duplicado
    W3-->>UI: 15 endereços incompletos
    W4-->>UI: 5 campos vazios
    W5-->>UI: 2 CPFs duplicados

    UI->>Analista: Relatório: 46 erros encontrados em 8s<br/>Pronto para corrigir e importar
```

**Por que no front-end?** O analista pode iterar rapidamente — corrigir o CSV no Excel, re-fazer upload, validar de novo — sem sobrecarregar o servidor. O processamento pesado fica no browser do usuário.

---

### 🚔 Análise de Logs de Incidentes Policiais

Uma **central de monitoramento urbano** recebe diariamente CSVs com milhões de registros de ocorrências policiais (como o dataset deste projeto). Um analista precisa responder:

> *"Quantos roubos de veículo (VEHICLE THEFT) ocorreram nesta região?"*

| | Sem Workers | Com 5 Workers + Streams |
|---|---|---|
| **Tempo** | 30+ segundos | ~6 segundos |
| **UI** | ❌ Congela | ✅ Responsiva |
| **Progress** | Nenhum feedback | Barra em tempo real |
| **Experiência** | Clica de novo achando que travou | Sabe exatamente quanto falta |

---

## 💡 Por que JavaScript?

Você pode pensar: *"Por que não fazer isso no backend com Python, Java, ou Go?"*

A resposta está no **contexto do sistema**. Se sua aplicação já roda em JavaScript — e a maioria das aplicações web modernas roda — usar Workers é uma extensão natural do que você já tem:

### 1. **Mesma linguagem, zero atrito**

```mermaid
graph TB
    subgraph "Stack JavaScript Unificada"
        FE["Frontend<br/>React / Vue / Vanilla JS"]
        WK["Web Workers<br/>Mesmo JS, threads separadas"]
        BE["Backend<br/>Node.js / Deno / Bun"]
        DB["Banco de Dados<br/>MongoDB / PostgreSQL"]
    end
    FE <--> WK
    FE <--> BE
    BE <--> DB

    style WK fill:#2563eb,color:#fff
```

O `service.js` que roda dentro do Worker é **o mesmo código** que poderia rodar na Main Thread ou em um servidor Node.js. Não precisa aprender outra linguagem, outro paradigma, ou manter dois codebases.

### 2. **Processamento no cliente, economia no servidor**

Em cenários como **Black Friday** ou **migração de dados**, o processamento pesado acontece no **browser do usuário**. Isso significa:

- ✅ **Zero custo de servidor** para processar CSVs
- ✅ **Dados sensíveis** (CPF, endereços) não saem da máquina do usuário  
- ✅ **Escala horizontal grátis** — cada usuário processa no próprio hardware
- ✅ **Sem filas** — não compete por recursos do backend

### 3. **Equipe já conhece**

| Cenário | Custo |
|---|---|
| Treinar dev JS a usar Workers | ⏱ 1-2 horas (é a mesma linguagem) |
| Treinar dev JS a usar Go/Rust para processamento | ⏱ Semanas/meses |
| Manter microserviço em Go só para processar CSV | 💰 Infra + deploy + monitoramento |
| Workers no browser | 💰 R$ 0,00 de infra |

### 4. **Ecossistema maduro**

A Web Workers API é suportada em **todos os browsers modernos** desde 2010. Streams API desde 2016. Não é tecnologia experimental — é o padrão da plataforma web.

| API | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|
| Web Workers | ✅ 4+ | ✅ 3.5+ | ✅ 4+ | ✅ 12+ |
| Streams API | ✅ 43+ | ✅ 65+ | ✅ 10.1+ | ✅ 14+ |
| Worker Modules | ✅ 80+ | ✅ 114+ | ✅ 15+ | ✅ 80+ |

---

## 📖 Code Review — The Art of Readable Code

O código deste projeto passou por um **code review** guiado pelo livro **["The Art of Readable Code"](https://www.oreilly.com/library/view/the-art-of/9781449318482/)** de **Dustin Boswell & Trevor Foucher** (O'Reilly).

### Por que este livro?

Em projetos que usam conceitos avançados como **Streams**, **Web Workers** e **message passing**, o código tende a ficar complexo rapidamente. O livro foca exatamente nisso: **tornar código complexo fácil de entender por qualquer pessoa** — não apenas por quem o escreveu.

Diferente de livros que focam em arquitetura ou design patterns, *The Art of Readable Code* trata do **nível micro**: nomes de variáveis, estrutura de loops, expressões, e comentários. São melhorias pequenas que, somadas, fazem a diferença entre um código que o time **lê** e um que o time **decifra**.

### Melhorias Aplicadas

| # | Princípio do Livro | Antes | Depois |
|---|---|---|---|
| 1 | **Nomes específicos** (Cap. 2) | `#findOcurrencies` (typo + vago) | `#countOccurrences` |
| 2 | **Evitar nomes genéricos** (Cap. 2) | `l`, `dps`, `args`, `progressFn` | `line`, `dependencies`, `result`, `reportProgress` |
| 3 | **Nomes sem ambiguidade** (Cap. 3) | `updateDebugLog(text, reset)` | `updateDebugLog(text, { append })` |
| 4 | **Unidades no nome** (Cap. 2) | `totalUploaded`, `totalBytes` | `totalUploadedBytes`, `fileSizeBytes` |
| 5 | **Variáveis explicativas** (Cap. 8) | `(100 / totalBytes) * totalUploaded` | `(totalUploadedBytes / fileSizeBytes) * 100` |
| 6 | **Extrair subproblemas** (Cap. 10) | CSV parsing duplicado em `transform`/`flush` | `#parseCsvLine()` extraído |
| 7 | **Extrair subproblemas** (Cap. 10) | Closure `elapsed()` duplicada 2x | `#elapsedSince(startTime)` como método |
| 8 | **Fluxo de controle** (Cap. 7) | `for...in` em arrays (antipattern) | `for` / `for...of` |
| 9 | **Expressões gigantes** (Cap. 8) | Template string com 5 expressões inline | Variáveis `workerId`, `found` extraídas |

> 💡 **Recomendação de leitura:** O livro é curto (~180 páginas), prático, e cheio de exemplos em múltiplas linguagens. Ideal para devs que querem escrever código que **outros** consigam manter.

---

## 🚀 Como Rodar

```bash
# Instalar dependências
npm install

# Iniciar o servidor com hot-reload
npm start
```

Acesse `http://localhost:3000` e:

1. Selecione um arquivo CSV
2. Digite um termo de busca (ex: `THEFT`, `DOMESTIC`)
3. Escolha o número de threads (1-16)
4. Marque/desmarque o checkbox Worker para comparar performance
5. Clique em **Search**

---

## 🛠 Tecnologias

- **Web Workers API** — multi-threading no browser
- **Streams API** — `ReadableStream`, `TransformStream`, `WritableStream`
- **ES Modules** — `import`/`export` nos Workers (`type: "module"`)
- **Browser Sync** — dev server com hot-reload

---

## 📁 Estrutura

```
mult-thread-streams/
├── index.html          # Formulário (file input, thread count, progress bar)
├── assets/
│   └── database-small.csv   # Dataset de exemplo (ocorrências policiais)
├── src/
│   ├── index.js        # Bootstrap
│   ├── controller.js   # Orquestração multi-worker + agregação
│   ├── service.js      # Pipeline de Streams (CSV → JSON → Search)
│   ├── view.js         # Manipulação DOM
│   └── worker.js       # Entry point para cada Worker thread
└── package.json
```
