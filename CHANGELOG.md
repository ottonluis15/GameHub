# Histórico de mudanças

## GameHub v1.3.0

Nesta versão, reorganizei a biblioteca do GameHub, ampliei a importação de jogos e adicionei um guia para quem está usando o aplicativo pela primeira vez.

### Novidades

- Nova interface com tema escuro, menu lateral, busca fixa ao rolar e ajuste de uma a cinco colunas.
- Modo edição com indicador visual no menu e nos cartões. Agora dá para alterar o nome, a capa e o caminho do executável.
- Importação de pastas cadastradas, com o nome da pasta exibido abaixo do título do jogo.
- Busca de capas pela Steam, integração opcional com SteamGridDB, cache local e imagem padrão para jogos sem capa.
- Logo própria no cabeçalho e ícone do Windows configurado para a janela e o executável.
- Guia **Como usar** exibido automaticamente na primeira abertura. Depois, ele pode ser consultado no menu.

### Melhorias e correções

- **Importar das lojas** também verifica as pastas cadastradas, ignora redistribuíveis como `Redist`, Visual C++, DirectX e .NET e remove da biblioteca os registros de loja com executável ausente.
- A importação da Steam verifica bibliotecas adicionais. A importação evita duplicatas pelo caminho do executável.
- A busca aceita nomes com ou sem acentos. A ordenação alfabética preserva o histórico de últimos jogados.
- Se um executável estiver ausente ao tentar jogar, o GameHub oferece opções para relocalizar o arquivo ou remover o cartão.
- Os botões **Adicionar jogo** e **Menu** voltaram a responder. O armazenamento da biblioteca passou a recuperar arquivos vazios ou inválidos com backup.
