// UserPromptSubmit: a short factual reminder that travels with every prompt,
// so a change asked for in plain conversation is not built past the documents.
import { readInput, findProject, stages, stageInfo, emit, probeMark } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const { state } = project;
const stage = stageInfo(state.stage);
const context =
  `Focus Blueprint: this project is at stage ${state.stage} of ${stages().length}` +
  (stage ? ` ("${stage.name}")` : '') +
  '. In this project a change to scope, screens or data is written into the specification files and the mockup first, and into the code after that.';

emit({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: context + probeMark('UserPromptSubmit'),
  },
});
