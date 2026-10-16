# Plugins do Claude Code do JGENTS

O repositório é também um marketplace de plugins do Claude Code: `.claude-plugin/marketplace.json` (na raiz)
lista o marketplace `jgents` com três plugins, um em cada pasta daqui: o mod `jgents` (só observa),
`jgents-permissions` (responder permissões pelo escritório) e `jgents-messages` (mandar mensagens pelo
escritório). O `npm run mod:install` instala os três; `--no-permissions` e `--no-messages` deixam o seu de fora.
As versões acompanham o `package.json` (o teste `server/test/mod.test.ts` falha se divergirem).

Testado com o **Claude Code 2.1.293** (o `jgents-messages`, por enquanto só pelo `claude plugin test` do
2.1.295). Mods (hooks em TypeScript carregados pelo próprio Claude Code) existem a partir da 2.1.287; a API ainda é
"early access" e pode mudar entre versões. Em versões anteriores, use os instaladores de sempre
(`npm run usage:install` e `npm run hooks:install`); mandar mensagens pelo escritório só existe com o mod. A
instalação está no README principal.

## `jgents` — o mod

`jgents/hooks/register.ts`, um módulo só, sem build. Liga cada sessão ao escritório sem ler a conversa:

- **Uso do plano (5h e semanal):** no início da sessão e a cada `session.measure` (depois de cada turno e quando
  um limite anda um ponto) lê `$.session.usage().rateLimits` e grava `~/.jgents/usage/<conta>.json` (ou em
  `JGENTS_USAGE_DIR`) no mesmo formato do tap de statusline, mais `"source": "mod"`. Substitui o
  `npm run usage:install`: o seu statusline fica intocado. A conta é a pasta de `CLAUDE_CONFIG_DIR` (o primeiro
  item) ou `~/.claude` (`~` é o `HOME`; no Windows sem ele, o `USERPROFILE`). Valores iguais gravados há menos de
  10 s não são regravados; falha ao gravar = silêncio.
- **"Precisa de você" embaixo do prompt:** a cada 5 s pergunta ao JGENTS local
  (`GET http://127.0.0.1:<JGENTS_PORT ou 4747>/api/mod/summary`) quem está esperando, já sem esta sessão e os
  subagentes dela, e mostra `🏢 Valentina precisa de você em loja-virtual` ou
  `🏢 2 precisam de você: Valentina (loja-virtual), Elias (app-mobile)` (até 3 nomes, depois "e mais N").
  Ninguém esperando ou JGENTS fora do ar: a linha some; fora do ar, as perguntas passam a ser a cada 30 s até
  ele voltar. Só em sessões que desenham (no `claude -p` não pergunta nada).
- **`/jgents`:** resumo do escritório inteiro, respondido pelo próprio mod (não chama o modelo, não gasta uso):

  ```
  JGENTS 0.3.0 em http://localhost:4747
  7 agentes · 3 trabalhando · 2 precisam de você
  ✋ Valentina (loja-virtual): aprovar uma permissão · dá para responder pelo escritório
  ✋ Elias (app-mobile): responder no terminal
  ```

  Fora do ar: `O JGENTS não respondeu em http://localhost:4747. Para subir: npm run docker:up na pasta do JGENTS.`

### O que ele acessa

Saída de `claude plugin validate --strict mod/jgents` (a análise estática que o Claude Code faz antes de
carregar o módulo; nada fora desta lista é chamado):

```
❯ ./register.ts hooks: session.start, session.measure, command.run{command=jgents}
❯ ./register.ts answers its own command: command.run{command=jgents}
❯ ./register.ts calls: $.clock.after (via askJGENTS), $.clock.every (via schedule), $.clock.now (via writeUsage), $.command.register, $.env.get (via readEnv), $.fs.write (via writeUsage), $.http.fetch (via askJGENTS), $.session.id (via poll), $.session.surfaces (via poll), $.session.usage, $.ui.status (via setStatus)
❯ ./register.ts env writes: nothing
❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, JGENTS_PORT, JGENTS_USAGE_DIR, HOME, USERPROFILE
```

Em palavras: só observa (nenhum hook decide nada: não aprova ferramentas, não muda prompts, não lê mensagens),
grava um único arquivo (o de uso), fala só com `127.0.0.1` e lê cinco variáveis de ambiente. `$.clock.after` é o
prazo de 2 s de cada pergunta ao JGENTS (`$.http.fetch` não aceita AbortSignal).

## `jgents-permissions` — responder permissões pelo escritório

Um hook `PermissionRequest` comum (sem mod), em `jgents-permissions/hooks/hooks.json`:

```json
{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/permission-hook.mjs\"", "timeout": 86430, "statusMessage": "Aguardando resposta no JGENTS" }] }
```

O script `hooks/permission-hook.mjs` é o mesmo que o `npm run hooks:install` instala (fonte única; Node puro, só
`node:*`, porque o Claude Code copia apenas a pasta do plugin para o cache). Ele manda o pedido ao JGENTS local
e espera a resposta por até 5 min; o diálogo continua no terminal e vale o que você responder primeiro. Sem o
JGENTS no ar ou sem nenhuma página aberta, sai na hora. Porta: `JGENTS_PORT` (padrão 4747); espera:
`JGENTS_PERMISSION_TIMEOUT` (padrão 300 s, até 86400 s = 24 h; o tempo limite do hook no plugin é 86430 s). Para aprovar
pelo celular longe do computador, ponha `"env": { "JGENTS_PERMISSION_TIMEOUT": "86400" }` no `settings.json` da
conta: vale para as sessões abertas depois. Subagentes em segundo plano só mostram o diálogo quando o hook termina,
por isso o padrão continua 5 min. Precisa de `node` 22+ no `PATH` da sessão.

`claude plugin validate --strict mod/jgents-permissions`: `✔ Validation passed` (o validador também confere o
esquema do `hooks.json`).

## `jgents-messages` — mensagens pelo escritório

`jgents-messages/hooks/register.ts`, um módulo só, sem build. Leva para a sessão o que você digita no escritório
(no painel do agente ou no terminal da tecla T), como se você tivesse digitado no terminal:

- **Busca:** a cada 2 s, só em sessões que desenham (no `claude -p` não pergunta nada),
  `POST http://127.0.0.1:<JGENTS_PORT ou 4747>/api/mod/inbox` com `{session, account}`. A pergunta também marca a
  sessão como presente: é ela que mostra, na página, a caixa de mensagem do agente (sem o plugin, a página dá a dica
  de instalar). Fora do ar, ou respondendo outra coisa (403 com as mensagens desligadas, 404 numa versão sem a
  rota), passa a perguntar a cada 30 s até ele voltar.
- **Entrega:** cada mensagem, na ordem, vai por `$.prompt.submit({ text, asUser: true })`. O modelo lê o texto como
  seu, sem o "The jgents-messages plugin sent a message" (o registro da sessão ainda diz que veio do plugin), e o
  texto vai exatamente como foi digitado. Com a sessão no meio de um turno, o Claude Code guarda o prompt e o roda
  num turno só dele quando o atual terminar (um prompt de plugin nunca entra no meio do turno, como um digitado
  pode entrar). Um hook que recuse a mensagem (`{drop}`) ou uma exceção viram falha, com o motivo, na página.
- **Confirmação:** um `POST /api/mod/inbox/ack` com o resultado de cada uma (`{session, results: [{id, ok, error?}]}`).
  A espera por mensagem é de no máximo 2 s: passou disso, a sessão está ocupada, a mensagem está na fila dela e
  conta como entregue (as seguintes vão em seguida, na ordem). Assim uma rodada nunca passa de uns poucos segundos e
  a presença (10 s) e a confirmação (30 s) do servidor não vencem com a sessão ocupada; o preço é que uma recusa
  depois desses 2 s não chega à página.

Fica separado do mod `jgents` de propósito: aquele só observa; este age, digitando na sessão em seu nome. Para
ficar sem ele: `npm run mod:install -- --no-messages` (um já instalado continua; para tirar:
`claude plugin uninstall jgents-messages@jgents`). O `npm run docker:up` atualiza o plugin de quem já o tem,
mas não o instala sozinho: numa conta com o mod e sem ele, só dá a dica de rodar o `npm run mod:install`.

### O que ele acessa

Saída de `claude plugin validate --strict mod/jgents-messages`:

```
❯ ./register.ts hooks: session.start
❯ ./register.ts calls: $.clock.after (via waitAtMost), $.clock.every (via schedule), $.env.get (via readEnv), $.http.fetch (via postJson), $.prompt.submit (via submitOne), $.session.id (via round), $.session.surfaces (via round)
❯ ./register.ts env writes: nothing
❯ ./register.ts env reads: CLAUDE_CODE_ENTRYPOINT, CLAUDE_CONFIG_DIR, JGENTS_PORT, HOME, USERPROFILE
```

Em palavras: um hook só (`session.start`, que liga o relógio das rodadas); a única ação na sessão é o
`$.prompt.submit` das mensagens; não lê a conversa, não grava arquivo nenhum, fala só com `127.0.0.1` e lê quatro
variáveis de ambiente (a conta sai do `CLAUDE_CONFIG_DIR`, como no mod). `$.clock.after` é o prazo de 2 s de cada
pedido ao JGENTS e de cada `$.prompt.submit`.

Porta: `JGENTS_PORT` (padrão 4747). Precisa do Claude Code 2.1.287+ e de um JGENTS com as mensagens ligadas: a
mesma trava do terminal e das permissões (porta presa ao `127.0.0.1` e cabeçalho Host local) e `JGENTS_MESSAGES`
não desligado (`0`, `false`, `off` ou `no` desligam). Qualquer processo desta máquina que fale com o JGENTS
consegue mandar uma mensagem às sessões com o plugin: por isso a trava local.

## Desenvolver

```bash
claude --plugin-dir mod/jgents                     # carrega o mod numa sessão, sem instalar (recarrega ao salvar)
claude -p "/jgents" --plugin-dir mod/jgents      # testa o comando sem sessão interativa (não chama o modelo)
cd mod/jgents && claude plugin test                # testes do mod (tests/*.test.ts), sem sessão, login nem rede
cd mod/jgents-messages && claude plugin test      # idem para o plugin de mensagens
claude plugin validate --strict mod/jgents         # análise estática + manifesto (idem para as outras pastas e .)
npx tsc -p mod/jgents                              # tipos (depois de carregar o mod uma vez com --plugin-dir)
```

Ao carregar um mod, o Claude Code grava os tipos da versão instalada em `<pasta>/.claude-plugin/types/` e um
`<pasta>/tsconfig.json` que os estende; os dois são gerados e ficam fora do git (`mod/.gitignore`). Os testes dos
mods importam `claude-code/testing` e só rodam pelo `claude plugin test`: o `npm test` (vitest) e o
`npm run typecheck` não olham esta pasta.
