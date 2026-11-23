<p align="center">
  <img src="assets/gamehub-icon.png" width="96" height="96" alt="Logo do GameHub">
</p>

# GameHub

O GameHub é um launcher de jogos para Windows feito com Electron. Ele reúne os jogos instalados no PC em uma biblioteca com capas, busca, filtros e acesso pelo cartão de cada jogo.

**Versão atual** `1.3.0` · [Histórico de mudanças](CHANGELOG.md)

## Recursos

- Importação de instalações locais da Steam, Epic Games e GOG.
- Importação de pastas cadastradas, com o nome da pasta de origem no cartão. O scanner ignora instaladores e redistribuíveis como Visual C++, DirectX e .NET.
- Cadastro manual por arquivo `.exe` e modo edição para atualizar o nome, a capa e o caminho do jogo.
- Busca por nome com ou sem acentos, filtros de origem, ordenação alfabética ou por últimos jogados e ajuste de uma a cinco colunas.
- Busca de capas pela Steam, com SteamGridDB opcional. As capas baixadas ficam no cache local.
- Guia de introdução na primeira abertura, disponível depois em **Menu → Como usar**.

## Executar pelo código-fonte

Em um PC com Windows, instale o Node.js com npm e execute os comandos abaixo no PowerShell, a partir da pasta do projeto.

```powershell
npm.cmd ci
npm.cmd start
```

## Como usar

1. Abra **Menu → Importar das lojas** para detectar jogos instalados e atualizar as pastas cadastradas.
2. Para incluir outra pasta, escolha **Menu → Adicionar pasta de jogos**. O GameHub procura executáveis nas subpastas e também na raiz selecionada.
3. Se preferir cadastrar um jogo individualmente, clique em **Adicionar jogo**, selecione o `.exe` e salve.
4. Clique no cartão para jogar. Para alterar o caminho, o nome ou a capa, ative **Menu → Modo edição** e abra o cartão.

Ao importar das lojas, jogos de loja cujo executável já foi removido saem da biblioteca. Essa ação afeta somente os registros do GameHub.

### Capas e dados locais

A busca de capas requer internet. Para habilitar a busca opcional no SteamGridDB, informe sua própria chave em **Menu → Configurações**. A biblioteca e as preferências ficam em arquivos locais na pasta de dados do aplicativo, no Windows em `%APPDATA%\GameHub`.

## Gerar o instalador

Depois de instalar as dependências, execute o comando abaixo no Windows.

```powershell
npm.cmd run build
```

O electron-builder gera `dist/GameHub Setup 1.3.0.exe` usando NSIS.

## 📥 Download

[⬇️ Baixar GameHub para Windows](https://github.com/USUARIO/REPOSITORIO/releases/latest/download/GameHub-Setup-1.3.0.exe)

## Estrutura do projeto

| Caminho | Responsabilidade |
| --- | --- |
| `main.js` e `preload.js` | Janela do Electron e comunicação com a interface |
| `main/` | Importação, persistência e busca de capas |
| `renderer/` | Interface em HTML, CSS e JavaScript |
| `assets/` | Logo, ícone do Windows e capa padrão |
