# Griffin Music

O Griffin Music é um aplicativo para separar músicas em faixas e praticar instrumento com mais liberdade. Você pode ouvir cada parte da música, diminuir ou aumentar o andamento, mudar a tonalidade, criar loops e acompanhar seu progresso.

[![Baixar Griffin Music](https://img.shields.io/badge/Baixar-Griffin%20Music-d4a531?style=for-the-badge&logo=github&logoColor=white)](https://github.com/britors/Griffin/releases/latest)

## O que você pode fazer

- Separar uma música em voz, bateria, baixo e outros instrumentos. Há também um modo opcional com guitarra e piano.
- Estudar com controle de velocidade, tonalidade, afinação, volume e panorâmica de cada faixa.
- Repetir um trecho usando loop A-B e praticar com metrônomo, contagem de entrada e andamento progressivo.
- Consultar BPM, tonalidade, seções, acordes e letras sincronizadas quando essas informações estiverem disponíveis.
- Organizar músicas e exercícios em projetos, pastas, favoritos e recentes.
- Salvar snapshots do seu estudo para continuar depois do mesmo ponto.
- Exportar a mixagem ou faixas individuais em WAV.

## Instalação

Baixe a versão mais recente na [página de releases](https://github.com/britors/Griffin/releases/latest) e escolha o arquivo correspondente ao seu sistema.

Os instaladores são para computadores de 64 bits (x86_64/amd64).

### Windows 10 e 11

1. Baixe o instalador `.exe`.
2. Abra o arquivo e siga as instruções na tela.
3. Inicie o Griffin Music pelo menu Iniciar ou pelo atalho criado.

Não é necessário instalar Node.js, Python ou outros programas para usar o instalador. Na primeira vez que você separar uma música, o Griffin fará o download do modelo necessário — esse download pode ter aproximadamente 1 GB.

Para desinstalar, abra **Configurações → Aplicativos → Aplicativos instalados**, encontre **Griffin Music** e escolha **Desinstalar**. Seus projetos e preferências são preservados.

### Ubuntu e Debian

1. Baixe o arquivo `.deb`.
2. Abra-o com a loja de aplicativos da sua distribuição e confirme a instalação.

Se preferir usar o terminal, na pasta onde o arquivo foi baixado execute:

```bash
sudo apt install ./nome-do-arquivo.deb
```

### Fedora, RHEL e openSUSE

1. Baixe o arquivo `.rpm`.
2. Abra-o com o instalador de aplicativos da sua distribuição e confirme a instalação.

Pelo terminal, use o comando correspondente:

```bash
# Fedora/RHEL
sudo dnf install ./nome-do-arquivo.rpm

# openSUSE
sudo zypper install ./nome-do-arquivo.rpm
```

### Instalação via OBS

O checkout local do OBS usa o projeto [`home:rodrigosbrito:lyra`](https://build.opensuse.org/project/show/home%3Arodrigosbrito%3Alyra), o pacote `griffin` e o repositório `openSUSE_Leap_16.0`. Depois que o pacote estiver publicado no OBS, instale-o com:

```bash
sudo zypper addrepo https://download.opensuse.org/repositories/home:/rodrigosbrito:/lyra/openSUSE_Leap_16.0/home:rodrigosbrito:lyra.repo
sudo zypper refresh
sudo zypper install griffin-music
```

O pacote ainda precisa estar publicado e construído no OBS para que o último comando encontre `griffin-music`.

### Arch Linux e Manjaro

Quando disponível, instale pelo AUR usando um helper, por exemplo:

```bash
yay -S griffin-music
```

Também é possível compilar usando o `PKGBUILD` do projeto:

```bash
git clone https://github.com/britors/Griffin.git
cd Griffin
makepkg -si
```

## Começando a usar

1. Abra o Griffin Music e importe uma música da sua biblioteca.
2. Escolha **Separar música** e aguarde o processamento.
3. Use o mixer para silenciar, destacar ou ajustar cada faixa.
4. Marque um trecho com o loop A-B e ajuste velocidade, tonalidade ou metrônomo para estudar.
5. Salve o projeto ou um snapshot para continuar mais tarde.

Os arquivos são processados no seu computador por padrão. O Griffin só envia áudio para um serviço remoto quando você escolhe essa opção e confirma a operação. Os modelos e o cache ficam armazenados localmente.

## Dicas importantes

- A primeira separação pode demorar mais porque o modelo precisa ser baixado e preparado.
- O modo padrão funciona usando o processador. Em computadores compatíveis, o suporte NVIDIA pode ser ativado em **Preferências → Processamento**.
- Para separar guitarra e piano, ative essa opção nas preferências depois de instalar o modelo padrão.
- A exportação disponível é em WAV PCM. Outros formatos poderão ser adicionados quando houver um codificador local compatível.
- Ao importar conteúdo da internet, use apenas materiais para os quais você tenha autorização e respeite os termos do serviço de origem.

## Ajuda e documentação

- [Manual do usuário](docs/MANUAL.md)
- [Política de privacidade](PRIVACY.md)
- [Como contribuir](CONTRIBUTING.md)
- [Documentação técnica](docs/ARCHITECTURE.md)

## Para desenvolver

Quem quiser contribuir com o projeto pode instalar Node.js 22.x, clonar o repositório e executar:

```bash
git clone git@github.com:britors/Griffin.git
cd Griffin
npm ci
npm run dev
```

As instruções de testes, empacotamento e publicação estão em [`docs/RELEASE.md`](docs/RELEASE.md).

## Licença

GPLv3. Consulte o arquivo [LICENSE](LICENSE).
