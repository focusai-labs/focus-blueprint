---
name: stage-01-connect
description: שלב 01 של Focus Blueprint. בודקים את שני החיבורים שכל פרויקט צריך, GitHub ו-Playwright, רושמים מה עוד מחובר, ומקימים את תיקיית הפרויקט, את המאגר עם כלל שמגן על main ואת כללי העבודה. מריצים אותו פעם אחת, בתחילת פרויקט חדש. החיבור ל-Supabase נמצא בתיקייה של השלב הזה, ושלב 10 מפעיל אותו.
model: sonnet
disable-model-invocation: true
---

# שלב 01: בדיקת חיבורים

בכל מקום שכתוב `bp`, מריצים `node "${CLAUDE_PLUGIN_ROOT}/scripts/bp.mjs"`.

## למה השלב הזה קיים

מה שהכי מהר תוקע פרויקט הוא חיבור שחסר באמצע הדרך. לכן בשלב הזה בודקים את החיבורים שכל פרויקט צריך, ורושמים מה עוד כבר מחובר. לא מחברים ולא מקימים שום דבר שעוד לא הוחלט עליו. את Supabase, Vercel ו-n8n מחברים רק אחרי שבוחרים מסלול בשלב 4. את החיבור ל-Supabase מפעיל שלב 10 כשפותחים את הפרויקט, לפי הקובץ `${CLAUDE_PLUGIN_ROOT}/skills/stage-01-connect/references/supabase-connect.md`.

## מה קוראים לפני שמתחילים

- השורה של שלב 1 בקובץ `${CLAUDE_PLUGIN_ROOT}/data/stages.json`.
- הפלט של `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-check.mjs"`.
- אם בתיקייה כבר יש `.blueprint/state.json`, סימן שהשלב הזה כבר רץ. עוצרים ומפנים את הסטודנט ל-`/blueprint`.

## מה עושים

0. מריצים `bp stage intro 1`, ומעבירים לסטודנט, מילה במילה, את הפתיחה שהפקודה הדפיסה.
1. מריצים את `install-check.mjs` ומציגים שורה לכל בדיקה: Node, Git, Playwright MCP ו-superpowers. כשחסר Node או Git, מראים איך מתקינים אותם לפי התיעוד הרשמי, דרך `/focus-blueprint:docs-verify`, ומחכים עד שההתקנה מסתיימת.
   - בודקים גם את הגרסה של Claude Code, כי בגרסה ישנה מ-2.1.277 חלק מהכללים והבדיקות של הכלי לא עובדים כמו שצריך. ב-VS Code הגרסה של Claude Code היא הגרסה של התוסף Claude Code, ולכן מבקשים מהסטודנט לפתוח את חלון התוספים (Cmd+Shift+X ב-Mac, Ctrl+Shift+X ב-Windows) ולכתוב איזו גרסה מופיעה ליד התוסף. מי שעובד בטרמינל מריץ `claude --version`. הגרסה של הפקודה `claude` בטרמינל לא תמיד זהה לגרסה של החלון ב-VS Code, כי התוסף מביא עותק משלו.
   - כשהגרסה נמוכה מ-2.1.277, הסטודנט מעדכן לפני שממשיכים. ב-VS Code מעדכנים את התוסף בחלון התוספים, ובטרמינל לפי https://code.claude.com/docs/en/setup, שקוראים דרך `/focus-blueprint:docs-verify`. אחרי העדכון פותחים שיחה חדשה.
2. בודקים את החיבור ל-GitHub עם `gh auth status`. אם הסטודנט לא מחובר, הוא מריץ בעצמו `gh auth login`, כי זו פעולה בחשבון שלו, ואחר כך בודקים שוב.
3. כש-Playwright MCP לא רשום, מראים את פקודת ההתקנה מהתיעוד הרשמי שלו, דרך `docs-verify`. אומרים לסטודנט שאחרי התקנה של MCP צריך לפתוח שיחה חדשה, כי הכלים נטענים רק בתחילת שיחה.
4. רושמים מה עוד מחובר, בלי לחבר שום דבר חדש: Supabase, Vercel, n8n, Cloudinary ו-fal. לכל אחד מהם מריצים `bp connections set <name> ok=<true|false> note="<מה נמצא>"`, וגם ל-`github` ול-`playwright`.
5. מריצים `claude mcp list`, וקוראים גם את `~/.claude.json` (השרתים הכלליים ושל התיקייה הזאת) ואת `.mcp.json`, בלי להדפיס שום מפתח. כל שרת של Supabase, בכתובת (`mcp.supabase.com`) או כחבילה `@supabase/mcp-server-supabase`, חייב להיות מחובר לפרויקט של הפרויקט הזה בלבד (`project_ref=` או `--project-ref=` עם ה-`ref` של שירות `supabase` במפה) ולקריאה בלבד (`read_only=true` או `--read-only`). שרת בלי `project_ref`, שרת של פרויקט אחר ושרת שיכול לכתוב, גם פרויקט חי של לקוח אחר, יכולים לשנות נתונים אמיתיים. כל עוד אין עדיין `ref` במפה, כל שרת כזה נחשב לא בטוח. כשיש שרת כזה, עוצרים, מסבירים את זה לסטודנט במשפט אחד ומבקשים ממנו לכבות את השרת לפרויקט הזה דרך `/mcp`, ואחר כך בודקים שוב. שרת עם `features=docs` בלבד מחפש רק בתיעוד, ולכן הוא נשאר.
6. מקימים מאגר מקומי עם `git init -b main`, ואחריו מריצים `bp init --name "<שם הפרויקט>"`, ובפרויקט גמר מוסיפים `--mode final-project`. הפקודה יוצרת את התיקיות, את קובץ המצב ואת המפה, ומוסיפה ל-`AGENTS.md` את כללי העבודה. כיוון שהמאגר כבר קיים, היא מתקינה גם את השער המקומי שמריץ את בדיקת המפה לפני כל commit. כשבפלט כתוב `"gitHook": false`, מריצים `bp githook install`.
7. רושמים אם superpowers מותקנת ובאיזו גרסה, עם `bp state set superpowers.installed=<true|false> superpowers.version=<x.y.z או null>`, לפי הפלט של צעד 1. אחר כך מריצים `bp route debugging`, ואומרים בשורה אחת מאיפה יגיעו הטכניקות בשלבי הבנייה, מ-superpowers או מהגרסה הקצרה של הכלי.
8. אם הסטודנט עוד לא החליף מודל, מסבירים לו בכמה שורות שהפקודה `/model` מחליפה את המודל בשיחה. שלבים שדורשים חשיבה רצים על המודל החזק, ושלבים של עבודה שחוזרת על עצמה רצים על מודל חסכוני. כל skill כותב על איזה מודל הוא רץ.
9. עושים commit ראשון על main. לפני שיוצרים את המאגר ב-GitHub, אומרים לסטודנט בשורה אחת שעומד להיווצר מאגר פרטי בשם `<name>` בחשבון ה-GitHub שלו ושהקוד יידחף אליו, ומחכים ל"כן" מפורש. אחרי האישור מריצים `gh repo create <name> --private --source . --push`. זה ה-commit היחיד שמותר לעשות ישר על main.
10. מגינים על main בכלל של GitHub. הכלל קובע שכל שינוי נכנס ל-main רק דרך PR, שהבדיקה `check` מהקובץ `.github/workflows/blueprint-check.yml` חייבת לעבור לפני מיזוג, ושאי אפשר למחוק את main או לדחוף אליו בכוח. זה שינוי בהרשאות של המאגר, ולכן מסבירים לסטודנט מה הכלל עושה ומבקשים אישור. אחרי האישור קוראים את https://docs.github.com/en/rest/repos/rules דרך `docs-verify`, ומריצים `gh api "repos/{owner}/{repo}/rulesets" --method POST --input "${CLAUDE_PLUGIN_ROOT}/templates/github/ruleset-main.json"`.
    - לפי https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets, כלל כזה במאגר פרטי זמין ב-GitHub Pro, ב-GitHub Team וב-GitHub Enterprise Cloud, ובתוכנית החינמית רק במאגר ציבורי. בפרויקט של לקוח ממליצים על תוכנית בתשלום, כי רק כך GitHub עצמו חוסם מיזוג של PR שהבדיקה שלו נכשלה. את המחיר קוראים בעמוד התוכניות של GitHub דרך `docs-verify`.
    - כשהסטודנט נשאר בתוכנית החינמית, GitHub לא יוצר את הכלל או לא אוכף אותו, והבדיקה של `rules/branches/main` חוזרת ריקה. אז השער הוא ה-hook המקומי ש-`bp init` התקין, יחד עם ה-hook של הכלי שחוסם commit ומיזוג ישר על main. רושמים את הפער ואת הסיכון שלו עם `bp ruling add decision="main מוגן רק במחשב של הסטודנט" why="בתוכנית החינמית GitHub לא אוכף כלל על מאגר פרטי" price="מי שממזג בדפדפן עוקף את כל הבדיקות" stage=1`.
11. לגבי עדכונים לכלי, קוראים את https://code.claude.com/docs/en/plugins/install.md דרך `docs-verify`, ומראים לסטודנט איך מפעילים עדכון אוטומטי. את ההגדרות שלו לא משנים בשבילו.

## מה חייב להיות נכון בסוף (ההוכחה)

- הפקודה `bp state get connections` מראה ש-`github.ok` ו-`playwright.ok` הם true.
- הפקודה `gh repo view --json name,visibility` מחזירה את המאגר, והוא פרטי.
- הקובץ `AGENTS.md` מתחיל בשורה `<!-- focus-blueprint -->`, ויש בו ארבעת סימוני העצירה.
- הפקודה `git log origin/main -1 --oneline` מראה את ה-commit הראשון.
- הפקודה `gh api "repos/{owner}/{repo}/rules/branches/main"` מחזירה את הכללים `pull_request` ו-`required_status_checks` עם הבדיקה `check`. בתוכנית החינמית יש במקומה הכרעה רשומה על הפער, והפקודה `git config core.hooksPath` מחזירה `.githooks`.
- אין שרת פעיל של Supabase שמחובר לפרויקט אחר, בלי `project_ref` או בלי קריאה בלבד, חוץ משרתי תיעוד (`features=docs`).

## מה נשאר בתיקייה

- `.blueprint/state.json`, `.blueprint/map.json`, `.blueprint/rulings.json`
- `AGENTS.md`, `.gitignore`, `.githooks/pre-commit`, `.github/workflows/blueprint-check.yml`, `scripts/blueprint-check.mjs`, `scripts/blueprint-model/`
- התיקיות `spec`, `mockup`, `db`, `evals`, `n8n`, `docs`
- במאגר ב-GitHub, הכלל `blueprint-main` על main

## סגירה

1. מריצים את פקודות ההוכחה ושומרים את הפלט שהן החזירו בפועל.
2. מציגים לסטודנט את ההכרעות שעוד לא דווחו לו, עם `bp ruling list --unreported --stage 1`, ואחר כך מריצים `bp ruling report --stage 1`.
3. סוגרים את השלב עם `bp stage done 1 --status <done|done_with_concerns|blocked|needs_context> --note "<הספק, החסם או המידע שחסר>" --proof "<הפלט>"`. כשהכלל של GitHub לא נוצר בגלל התוכנית, הסטטוס הוא `done_with_concerns`, והפער כתוב בהערה.
4. בשלב הזה אין PR. ה-commit הראשון נכנס ישר ל-main, וזה המקרה היחיד שבו זה מותר.
5. כותבים את `.blueprint/last-session.md`, עד 30 שורות: מה נעשה, מה פתוח ומה הצעד הבא.
6. אומרים לסטודנט במשפט אחד, בלי לייפות, איך השלב נסגר, עם הסטטוס ועם הפלט של ההוכחה. אחר כך אומרים בשתי שורות שהשלב הבא הוא תיאור הרעיון, ושפותחים אותו בשיחה חדשה עם `/blueprint`.
