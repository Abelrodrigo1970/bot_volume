# Deploy no Railway (Railpack)

Se o Railpack reportar que só encontra `README.md` e falhar com "could not determine how to build":

1. **Root Directory** – No dashboard do Railway, no teu serviço: **Settings → Build → Root Directory**. Deve estar **vazio** (ou `/`) para que o build use a raiz do repositório, onde estão `package.json`, `src/`, etc. Se estiver preenchido com uma subpasta, o Railpack só vê essa pasta (por exemplo só o README).

2. **Branch** – Confirma que o deploy usa o branch correto (ex.: `main`) onde está o código.

3. Depois de corrigir, faz **Redeploy** no Railway.

Este projeto inclui `railpack.json` (provider Node + start command) e `Procfile` para o Railpack reconhecer a app como Node e saber como iniciá-la.
