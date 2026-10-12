# Ponto

App para bater o ponto pelo celular e controlar horas extras e banco de horas. Funciona offline, instala como app e guarda tudo no seu Firebase.

## 1. Criar o projeto no Firebase (grátis)

1. Acesse https://console.firebase.google.com e crie um projeto (pode desativar o Google Analytics).
2. **Build > Authentication > Get started**. Ative **E-mail/senha** (e **Google**, se quiser).
3. **Build > Firestore Database > Create database**. Escolha uma região (ex.: `southamerica-east1`) e o modo produção.
4. Na aba **Rules** do Firestore, cole o conteúdo de `firestore.rules` e clique em **Publish**.
5. **Configurações do projeto (engrenagem) > Seus aplicativos > ícone `</>` (Web)**. Registre o app e copie o `firebaseConfig`.
6. Cole esses valores em `firebase-config.js`.

## 2. Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie todos os arquivos desta pasta para a raiz dele.
2. No repositório: **Settings > Pages > Source: Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Aguarde um ou dois minutos. O endereço será `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
4. De volta ao Firebase: **Authentication > Settings > Authorized domains > Add domain** e adicione `SEU-USUARIO.github.io`. Sem isso o login não funciona.

## 3. Instalar no celular

- **Android (Chrome):** abra o endereço, toque em **Ajustes > Instalar no celular** (ou menu ⋮ > Instalar app).
- **iPhone (Safari):** Compartilhar > **Adicionar à Tela de Início**.

## Como o saldo é calculado

- Cada toque no botão registra a hora atual. Os registros formam pares: entrada, saída, entrada, saída...
- Saldo do dia = horas trabalhadas menos a jornada. Em dias que não são de trabalho (ex.: fim de semana), tudo o que você trabalhar vira extra.
- A **tolerância** dos Ajustes zera o saldo do dia quando a diferença é pequena. Use 0 para contar tudo.
- Feriado, folga ou abono: toque no dia no Histórico e marque a opção. A jornada daquele dia passa a ser zero.
- Dias com uma saída faltando não entram na conta até você corrigir. O dia de hoje só entra no saldo quando passa da jornada.
- Esqueceu de bater? Toque no dia no Histórico e adicione ou corrija os horários.
- O **saldo inicial** nos Ajustes serve para levar para o app o banco de horas que você já tinha.

## Limitações

- Turnos que viram a meia-noite não são suportados: cada dia é calculado separadamente.
- É um controle pessoal. Ele não substitui o ponto oficial da empresa.
