---
name: stage-01-connect
description: שלב 01 של Focus Blueprint. בודק את החיבורים שכל פרויקט צריך, GitHub ו-Playwright, רושם מה עוד מחובר, ומקים את תיקיית הפרויקט, המאגר וכללי העבודה. מריצים אותו פעם אחת, בתחילת פרויקט חדש.
model: sonnet
disable-model-invocation: true
---

# שלב 01: בדיקת חיבורים

בכל מקום שכתוב `bp`, מריצים `node "${CLAUDE_PLUGIN_ROOT}/scripts/bp.mjs"`.

## למה השלב הזה קיים

פרויקט נתקע הכי מהר על חיבור שחסר באמצע הדרך. בשלב הזה בודקים רק את מה שכל פרויקט צריך, ורושמים מה עוד כבר מחובר. לא מחברים ולא מקימים שום דבר שעוד לא הוחלט עליו: Supabase, Vercel ו-n8n נכנסים רק אחרי שבוחרים מסלול, בשלב 4.

## מה קוראים לפני שמתחילים

- בקובץ `${CLAUDE_PLUGIN_ROOT}/data/stages.json`, השורה של שלב 1.
- הפלט של `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-check.mjs"`.
- אם בתיקייה כבר יש `.blueprint/state.json`, השלב הזה כבר רץ. עוצרים, ומפנים ל-`/blueprint`.

## מה עושים

1. מריצים את `install-check.mjs` ומציגים שורה לכל בדיקה: Node, Git, Playwright MCP, superpowers. כשחסר Node או Git, מראים איך מתקינים לפי התיעוד הרשמי, דרך `/focus-blueprint:docs-verify`, ומחכים עד שזה מותקן.
2. בודקים GitHub עם `gh auth status`. אם אין התחברות, הסטודנט מריץ בעצמו `gh auth login`, כי זו פעולה בחשבון שלו, ואז בודקים שוב.
3. כש-Playwright MCP לא רשום, מראים את פקודת ההתקנה מהתיעוד הרשמי שלו, דרך `docs-verify`. אומרים שאחרי התקנה של MCP פותחים שיחה חדשה, כי הכלים נטענים רק בתחילת שיחה.
4. רושמים מה עוד מחובר, בלי לחבר שום דבר חדש: Supabase, Vercel, n8n, Cloudinary ו-fal. לכל אחד מריצים `bp connections set <name> ok=<true|false> note="<מה נמצא>"`, וגם ל-`github` ול-`playwright`.
5. מריצים `bp init --name "<שם הפרויקט>"`. בפרויקט גמר מוסיפים `--mode final-project`. הפקודה יוצרת את התיקיות, את קובץ המצב ואת המפה, ומוסיפה ל-`AGENTS.md` את כללי העבודה.
6. רושמים את superpowers: `bp state set superpowers.installed=<true|false> superpowers.version=<x.y.z או null>`, לפי הפלט של שלב 1. אחר כך מריצים `bp route debugging`, ואומרים בשורה אחת מאיפה יגיעו הטכניקות בשלבי הבנייה, מ-superpowers או מהגרסה הקצרה של הכלי.
7. אם הסטודנט עוד לא החליף מודל, מסבירים בכמה שורות: הפקודה `/model` מחליפה את המודל בשיחה. שלבים של חשיבה רצים על המודל החזק, ושלבים של עבודה שחוזרת על עצמה רצים על מודל חסכוני. כל skill אומר על איזה מודל הוא רץ.
8. מקימים את המאגר: `git init -b main`, commit ראשון על main, שהוא המקום היחיד שבו מותר commit על main, ואז `gh repo create <name> --private --source . --push`. אומרים פעם אחת שבמאגר פרטי בחשבון החינמי GitHub לא חוסם מיזוג של PR עם בדיקה אדומה, ולכן הכלי חוסם מיזוג מקומי ל-main, ו-Claude לא ממזג PR אדום.
9. עדכונים לכלי: קוראים את https://code.claude.com/docs/en/plugins/install.md דרך `docs-verify`, ומראים לסטודנט איך מפעילים עדכון אוטומטי. לא משנים את ההגדרות שלו בשבילו.

## מה חייב להיות נכון בסוף (ההוכחה)

- הפקודה `bp state get connections` מראה `github.ok` ו-`playwright.ok` כ-true.
- הפקודה `gh repo view --json name,visibility` מחזירה את המאגר, והוא פרטי.
- הקובץ `AGENTS.md` מתחיל בשורה `<!-- focus-blueprint -->`, ויש בו ארבעת סימוני העצירה.
- הפקודה `git log origin/main -1 --oneline` מראה את ה-commit הראשון.

## מה נשאר בתיקייה

- `.blueprint/state.json`, `.blueprint/map.json`, `.blueprint/rulings.json`
- `AGENTS.md`, `.gitignore`, `.github/workflows/blueprint-check.yml`, `scripts/blueprint-check.mjs`
- התיקיות `spec`, `mockup`, `db/migrations`, `evals`, `n8n`, `docs`

## סגירה

1. מריצים את פקודות ההוכחה, ושומרים את הפלט האמיתי שלהן.
2. מציגים לסטודנט הכרעות שעוד לא דווחו: `bp ruling list --unreported --stage 1`, ואז `bp ruling report --stage 1`.
3. סוגרים: `bp stage done 1 --status <done|done_with_concerns|blocked|needs_context> --note "<הספק, החסם או המידע שחסר>" --proof "<הפלט>"`.
4. בשלב הזה אין PR: ה-commit הראשון נכנס ישר ל-main, וזה הכלל היחיד שבו מותר.
5. כותבים את `.blueprint/last-session.md`: מה נעשה, מה פתוח, והצעד הבא, עד שלושים שורות.
6. אומרים לסטודנט בשורה אחת כנה איך השלב נסגר, עם הסטטוס ועם הפלט של ההוכחה. אחר כך שתי שורות: הבא בתור הוא שפיכת הרעיון, והוא נפתח בשיחה חדשה עם `/blueprint`.
