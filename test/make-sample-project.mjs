// Create a throwaway Blueprint project, for the tests and for trying the plugin by hand.
//   node test/make-sample-project.mjs <folder> [stage]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function makeSampleProject(dir, { stage = 3, commit = true } = {}) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    throw new Error(`The folder ${dir} exists and is not empty.`);
  }
  const write = (rel, content) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  write(
    '.blueprint/state.json',
    JSON.stringify({ schema: 1, project: 'איסוף מסמכים לרואה חשבון', stage, status: 'in_progress', updatedAt: '2026-11-16' }, null, 2) + '\n'
  );
  write(
    '.blueprint/map.json',
    JSON.stringify(
      {
        schema: 1,
        capabilities: [
          {
            id: 'upload-documents',
            name: 'לקוח מעלה מסמכים',
            screens: ['mockup/index.html'],
            data: [],
            permissions: [],
            automations: [],
            test: null,
          },
        ],
      },
      null,
      2
    ) + '\n'
  );
  write(
    'mockup/index.html',
    '<!doctype html>\n<html lang="he" dir="rtl">\n<meta charset="utf-8">\n<title>העלאת מסמכים</title>\n<h1>העלאת מסמכים</h1>\n</html>\n'
  );
  write('db/migrations/.gitkeep', '');
  write('.gitignore', '.blueprint/ui/\n');

  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init');
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  if (commit) {
    git('add', '-A');
    git('-c', 'user.name=Focus Blueprint', '-c', 'user.email=blueprint@example.invalid', 'commit', '-m', 'Sample project');
  }
  return dir;
}

if (process.argv[1] && path.basename(process.argv[1]) === 'make-sample-project.mjs') {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node test/make-sample-project.mjs <folder> [stage]');
    process.exit(1);
  }
  const dir = makeSampleProject(path.resolve(target), { stage: Number(process.argv[3] || 3) });
  console.log(`Sample project created at ${dir}`);
}
