---
name: ui-probe
description: Skeleton check of the Focus Blueprint local page. Starts the bundled page on this machine, waits for the user to save one sentence in it, and reads the sentence back from the project folder. Run only when the user asks for the Blueprint page check.
model: haiku
disable-model-invocation: true
---

# Focus Blueprint: local page check

This check proves that a page served from the plugin can hand an answer to Claude through a file in the project.

## What to do

1. Start the page server in the background. Use the shell tool with `run_in_background` set to true, and put the absolute path of the project root in place of PROJECT:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/ui/serve.mjs" --project "PROJECT" --once
   ```

   The server prints one line, `URL http://127.0.0.1:...`, and opens that address in the browser.

2. Tell the user, in one Hebrew sentence, that a page opened in the browser and that they write one sentence there and press שמירה. Give them the address in case the browser did not open.

3. Wait for the answer in the foreground, with the shell tool's timeout set to 300000 milliseconds:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/ui/wait.mjs" --project "PROJECT" --name probe --timeout 280
   ```

   The command prints the saved answer as JSON. If it prints `TIMEOUT`, ask the user whether they saved, and run the same command once more.

4. Report in Hebrew, in two short lines: the sentence the user wrote, and the file it was saved in (`.blueprint/ui/answers/probe.json`).

If the server does not start or the address does not answer, say so plainly with the error text. Do not try another way.

Every line of the answer opens with a Hebrew word, so it reads right to left.
