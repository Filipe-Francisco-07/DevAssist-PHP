# DevAssist PHP

> Trabalho de conclusão do curso de Bacharelado em Ciência da Computação.

> Extensão para Visual Studio Code que gera automaticamente documentação PHPDoc, testes unitários e integração contínua para projetos PHP, com suporte aos modelos de linguagem OpenAI e Google Gemini.

---

## Sobre o Projeto

**DevAssist PHP** é uma extensão para o VS Code desenvolvida como TCC, ela analisa o código-fonte PHP via AST, extrai metadados estruturais e gera automaticamente docblocks no padrão **PHPDoc** usando as APIs da OpenAI ou Google Gemini (conforme configurado pelo usuário).

O desenvolvedor seleciona um trecho de código no editor e recebe a documentação inserida diretamente no arquivo.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                Extensão VSCode                          │
│              (interface do usuário)                     │
└───────────────────────┬─────────────────────────────────┘
                        │ Seleciona código PHP
                        ▼
┌─────────────────────────────────────────────────────────┐
│               Serviços Node.js (services/)              │
│  engineRunner · git · github · secrets · dashboard      │
│  testRunner · n8n · n8nExporter · config · output       │
└───────────────────────┬─────────────────────────────────┘
                        │ Chama subprocesso
                        ▼
┌─────────────────────────────────────────────────────────┐
│               Engine PHP (engine/src/)                  │
│                                                         │
│  Normalizador → ServicoAst → MarcadorDocumentacao       │
│       ↓               ↓              ↓                  │
│  ValidadorDocblock  [AST]    ConstrutorPrompt           │
│       ↓                              ↓                  │
│  InjetorPlaceholder          FabricaClienteLLM          │
│       ↓                        ↙         ↘             │
│  AplicadorDocumentacao  ClienteOpenAI  ClienteGemini    │
└───────────────────────┬─────────────────────────────────┘
                        │ prompt estruturado
                        ▼
┌─────────────────────────────────────────────────────────┐
│            API OpenAI / Google Gemini                   │
│         (geração do docblock em PHPDoc)                 │
└─────────────────────────────────────────────────────────┘
```

O sistema é dividido em duas camadas:

- **Camada JavaScript:** gerencia a interface com o VS Code, orquestra serviços externos (GitHub e n8n) e chama o engine PHP como subprocesso.
- **Camada PHP:** analisa o código via AST, extrai metadados e chama a API da IA para gerar a documentação.

---

## Funcionalidades

### Documentação automática
- Analisa o código PHP via AST usando [nikic/PHP-Parser](https://github.com/nikic/PHP-Parser)
- Extrai classes, métodos, parâmetros, tipos de retorno e exceções lançadas
- Gera docblocks no padrão **PHPDoc** 
- Insere a documentação no arquivo com suporte ao Ctrl+Z (caso usuário queira retornar alteração)
- Não sobrescreve documentações já existentes e completas

### Geração de testes unitários
- Gera classes de teste **PHPUnit** automaticamente para cada classe PHP do projeto
- Cobre caminho feliz, valores limite e entradas inválidas
- Não sobrescreve testes já escritos pelo desenvolvedor

### Integração com Git e GitHub
- Fluxo de push integrado: documenta, executa testes, sincroniza secrets e envia para o GitHub
- Criação automática do arquivo `.github/workflows/ci.yml` com pipeline completo
- Sincronização automática de secrets do repositório (API key, tokens) via API do GitHub com criptografia libsodium

### Dashboard de monitoramento
- Painel Webview dentro do VS Code com dados em tempo real do repositório GitHub
- Exibe: linguagens, execuções do GitHub Actions, contribuidores, issues, pull requests e releases

### Sistema de notificações (n8n)
- Envia notificações por e-mail via webhook para eventos de push, resultados de testes e geração de documentação
- Inclui template de workflow n8n pronto para importação e personalização (usuário deve exportá-lo e importar em sua instância n8n, configurando smtp para o envio de e-mails)

---

## Tecnologias Utilizadas

| Tecnologia | Uso |
|---|---|
| **VS Code Extension API** | Interface com o editor |
| **Node.js** | Camada de serviços da extensão |
| **PHP 8.2+** | Engine de análise e geração |
| **nikic/PHP-Parser** | Análise sintática e geração de AST |
| **OpenAI API** | Geração de docblocks (GPT-4o-mini padrão) |
| **Google Gemini API** | Alternativa ao OpenAI |
| **PHPUnit** | Execução de testes unitários |
| **GitHub Actions** | Pipeline CI/CD automatizado |
| **GitHub Pages** | Hospedagem da documentação gerada |
| **n8n** | Automação de notificações por e-mail |
| **libsodium** | Criptografia de secrets enviados ao GitHub |

---

## Instalação

### Pré-requisitos
- VS Code 1.85 ou superior
- PHP 8.2+ instalado no sistema
- Composer
- Node.js 18+

### Instalar a extensão

**Via marketplace:**
Acesse o marketplace do VS Code e busque por **DevAssist PHP**.
```

**Via arquivo `.vsix`:**
```bash
code --install-extension devassist-php-0.1.0.vsix
```

Ou acesse **Extensões → ⋯ → Instalar pelo VSIX** dentro do VS Code.

**Via código-fonte:**
```bash
git clone https://github.com/Filipe-Francisco-07/DevAssist-PHP.git
cd DevAssist-PHP
npm install
cd engine && composer install && cd ..
```
Pressione `F5` no VS Code para abrir a janela de extensão em modo debug.

---

## Configuração

Após instalar, acesse as configurações do VS Code (`Ctrl+,`) e busque por **DevAssist PHP**:

| Configuração | Padrão | Descrição |
|---|---|---|
| `phpDocgen.llm.provider` | `openai` | Provedor de IA (`openai` ou `gemini`) |
| `phpDocgen.llm.model` | *(padrão do provedor)* | Modelo específico a usar |
| `phpDocgen.llm.base` | *(endpoint oficial)* | URL base da API (para proxies) |
| `phpDocgen.autoDocumentOnCommit` | `true` | Documentar automaticamente ao commitar |
| `phpDocgen.runTestsBeforePush` | `false` | Executar testes antes do push |
| `phpDocgen.n8n.notifyOnPush` | `true` | Notificar n8n após push |
| `phpDocgen.n8n.notifyOnTests` | `true` | Notificar n8n com resultado dos testes |

### Configurar credenciais

Clique com o botão direito no editor → **DevAssist PHP** e utilize os comandos:

- **Configurar chave API** — chave da OpenAI ou Gemini
- **Configurar GitHub Token** — Personal Access Token com permissão de escrita
- **Configurar Webhook n8n** — URL do webhook para notificações

Relaxa, suas credenciais são armazenadas no cofre de credenciais nativo do sistema operacional (Keychain / Credential Manager / Secret Service) e nunca em arquivos do projeto.

---

## Como Usar

### Documentar um trecho de código
1. Abra um arquivo `.php` no VS Code
2. Selecione o trecho desejado (classe, método ou função)
3. Clique com o botão direito → **DevAssist PHP → Documentar trecho selecionado**
4. Aguarde, o docblock será inserido automaticamente acima do elemento

### Documentar o arquivo inteiro
1. Abra um arquivo `.php`
2. Clique com o botão direito → **DevAssist PHP → Documentar arquivo inteiro**
3. Apenas os elementos sem documentação (ou com documentação incompleta) serão processados

### Gerar testes unitários
1. Clique com o botão direito → **DevAssist PHP → Gerar Testes para o Projeto**
2. Os arquivos de teste serão criados no diretório configurado em `phpDocgen.testsDir`

### Enviar para o GitHub
1. Clique com o botão direito → **DevAssist PHP → Enviar projeto para GitHub**
2. O fluxo executa automaticamente: documenta → testa → sincroniza secrets → push

---

## Estrutura do Projeto

```
devassist-php/
├── .github/
│   └── workflows/
│       └── ci.yml              # Pipeline CI/CD da extensão
├── engine/                     # Engine PHP
│   ├── bin/
│   │   ├── run.php             # Ponto de entrada: documentação
│   │   ├── generate-tests.php  # Ponto de entrada: geração de testes
│   │   └── analyze.php         # Ponto de entrada: análise
│   ├── src/
│   │   ├── Analyser/
│   │   │   ├── MarcadorDocumentacao.php   # Visitor AST — extração de metadados
│   │   │   └── ValidadorDocblock.php      # Verifica necessidade de documentação
│   │   ├── Generator/
│   │   │   ├── AplicadorDocumentacao.php  # Orquestra o fluxo completo
│   │   │   ├── ClienteLLMInterface.php    # Interface dos clientes LLM
│   │   │   ├── ClienteOpenAI.php          # Cliente OpenAI (cURL)
│   │   │   ├── ClienteGemini.php          # Cliente Google Gemini (cURL)
│   │   │   ├── FabricaClienteLLM.php      # Factory Method para seleção do cliente
│   │   │   ├── ConstrutorPrompt.php       # Construção do prompt para documentação
│   │   │   └── ConstrutorPromptTeste.php  # Construção do prompt para testes
│   │   ├── Parser/
│   │   │   ├── Normalizador.php           # Normalização do código de entrada
│   │   │   └── ServicoAst.php             # Parsing via PHP-Parser
│   │   └── Util/
│   │       └── InjetorPlaceholder.php     # Inserção de marcadores no código
│   └── tests/                  # Testes unitários PHPUnit
├── services/                   # Módulos Node.js
│   ├── config.js               # Leitura das configurações do VS Code
│   ├── dashboard.js            # Painel Webview com dados do GitHub
│   ├── engineRunner.js         # Invocação do subprocesso PHP
│   ├── git.js                  # Integração Git e GitHub Secrets
│   ├── github.js               # Comunicação com a API REST do GitHub
│   ├── n8n.js                  # Envio de notificações via webhook
│   ├── n8nExporter.js          # Exportação personalizada do workflow n8n
│   ├── output.js               # Canal de saída do VS Code
│   ├── secrets.js              # Armazenamento seguro de credenciais
│   └── testRunner.js           # Geração e execução de testes PHPUnit
├── extension.js                # Ponto de entrada da extensão
├── n8n-workflow.json           # Template do workflow n8n
└── package.json                # Manifesto da extensão
```

---

## Pipeline CI/CD

O arquivo `.github/workflows/ci.yml` gerado automaticamente pela extensão configura o seguinte pipeline para o repositório do usuário:

```
push → main/master
    ├── Instalar dependências PHP (Composer)
    ├── Executar testes unitários (PHPUnit)
    ├── Gerar documentação HTML (phpDocumentor)
    └── Publicar no GitHub Pages
```

---

## Licença

Desenvolvido como Trabalho de conclusão do curso de Bacharelado em Ciência da Computação - Instituto Federal Catarinense - Campus Rio do Sul. Distribuído sob a licença MIT.

---

## Autor

**Filipe Francisco Franknberger**  
[github.com/Filipe-Francisco-07](https://github.com/Filipe-Francisco-07)
