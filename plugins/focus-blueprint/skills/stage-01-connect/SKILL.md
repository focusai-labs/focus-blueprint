---
name: stage-01-connect
description: שלב 01 של Focus Blueprint. בודקים את שני החיבורים שכל פרויקט צריך, GitHub ו-Playwright, רושמים מה עוד מחובר, ומקימים את תיקיית הפרויקט, את המאגר ואת כללי העבודה. מריצים אותו פעם אחת, בתחילת פרויקט חדש.
model: sonnet
disable-model-invocation: true
---

# שלב 01: בדיקת חיבורים

בכל מקום שכתוב `bp`, מריצים `node "${CLAUDE_PLUGIN_ROOT}/scripts/bp.mjs"`.

## למה השלב הזה קיים

מה שהכי מהר תוקע פרויקט הוא חיבור שחסר באמצע הדרך. לכן בשלב הזה בודקים את החיבורים שכל פרויקט צריך, ורושמים מה עוד כבר מחובר. לא מחברים ולא מקימים שום דבר שעוד לא הוחלט עליו. את Supabase, Vercel ו-n8n מחברים רק אחרי שבוחרים מסלול, בשלב 4.

## מה קוראים לפני שמתחילים

- השורה של שלב 1 בקובץ `${CLAUDE_PLUGIN_ROOT}/data/stages.json`.
- הפלט של `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-check.mjs"`.
- אם בתיקייה כבר יש `.blueprint/state.json`, סימן שהשלב הזה כבר רץ. עוצרים ומפנים את הסטודנט ל-`/blueprint`.

## מה עושים

1. מריצים את `install-check.mjs` ומציגים שורה לכל בדיקה: Node, Git, Playwright MCP ו-superpowers. כשחסר Node או Git, מראים איך מתקינים אותם לפי התיעוד הרשמי, דרך `/focus-blueprint:docs-verify`, ומחכים עד שההתקנה מסתיימת.
2. בודקים את החיבור ל-GitHub עם `gh auth status`. אם הסטודנט לא מחובר, הוא מריץ בעצמו `gh auth login`, כי זו פעולה בחשבון שלו, ואחר כך בודקים שוב.
3. כש-Playwright MCP לא רשום, מראים את פקודת ההתקנה מהתיעוד הרשמי שלו, דרך `docs-verify`. אומרים לסטודנט שאחרי התקנה של MCP צריך לפתוח שיחה חדשה, כי הכלים נטענים רק בתחילת שיחה.
4. רושמים מה עוד מחובר, בלי לחבר שום דבר חדש: Supabase, Vercel, n8n, Cloudinary ו-fal. לכל אחד מהם מריצים `bp connections set <name> ok=<true|false> note="<מה נמצא>"`, וגם ל-`github` ול-`playwright`.
5. מריצים `bp init --name "<שם הפרויקט>"`, ובפרויקט גמר מוסיפים `--mode final-project`. הפקודה יוצרת את התיקיות, את קובץ המצב ואת המפה, ומוסיפה ל-`AGENTS.md` את כללי העבודה.
6. רושמים אם superpowers מותקנת ובאיזו גרסה, עם `bp state set superpowers.installed=<true|false> superpowers.version=<x.y.z או null>`, לפי הפלט של צעד 1. אחר כך מריצים `bp route debugging`, ואומרים בשורה אחת מאיפה יגיעו הטכניקות בשלבי הבנייה, מ-superpowers או מהגרסה הקצרה של הכלי.
7. אם הסטודנט עוד לא החליף מודל, מסבירים לו בכמה שורות שהפקודה `/model` מחליפה את המודל בשיחה. שלבים שדורשים חשיבה רצים על המודל החזק, ושלבים של עבודה שחוזרת על עצמה רצים על מודל חסכוני. כל skill כותב על איזה מודל הוא רץ.
8. מקימים את המאגר עם `git init -b main`, עושים commit ראשון על main ואז מריצים `gh repo create <name> --private --source . --push`. זה ה-commit היחיד שמותר לעשות ישר על main. אומרים לסטודנט פעם אחת שבמאגר פרטי בחשבון החינמי, GitHub לא חוסם מיזוג של PR שהבדיקה שלו נכשלה. לכן הכלי חוסם מיזוג מקומי ל-main, ו-Claude לא ממזג PR עם בדיקה אדומה.
9. לגבי עדכונים לכלי, קוראים את https://code.claude.com/docs/en/plugins/install.md דרך `docs-verify`, ומראים לסטודנט איך מפעילים עדכון אוטומטי. את ההגדרות שלו לא משנים בשבילו.

## מה חייב להיות נכון בסוף (ההוכחה)

- הפקודה `bp state get connections` מראה ש-`github.ok` ו-`playwright.ok` הם true.
- הפקודה `gh repo view --json name,visibility` מחזירה את המאגר, והוא פרטי.
- הקובץ `AGENTS.md` מתחיל בשורה `<!-- focus-blueprint -->`, ויש בו ארבעת סימוני העצירה.
- הפקודה `git log origin/main -1 --oneline` מראה את ה-commit הראשון.

## מה נשאר בתיקייה

- `.blueprint/state.json`, `.blueprint/map.json`, `.blueprint/rulings.json`
- `AGENTS.md`, `.gitignore`, `.github/workflows/blueprint-check.yml`, `scripts/blueprint-check.mjs`
- התיקיות `spec`, `mockup`, `db/migrations`, `evals`, `n8n`, `docs`

## סגירה

1. מריצים את פקודות ההוכחה ושומרים את הפלט שהן החזירו בפועל.
2. מציגים לסטודנט את ההכרעות שעוד לא דווחו לו, עם `bp ruling list --unreported --stage 1`, ואחר כך מריצים `bp ruling report --stage 1`.
3. סוגרים את השלב עם `bp stage done 1 --status <done|done_with_concerns|blocked|needs_context> --note "<הספק, החסם או המידע שחסר>" --proof "<הפלט>"`.
4. בשלב הזה אין PR. ה-commit הראשון נכנס ישר ל-main, וזה המקרה היחיד שבו זה מותר.
5. כותבים את `.blueprint/last-session.md`, עד 30 שורות: מה נעשה, מה פתוח ומה הצעד הבא.
6. אומרים לסטודנט במשפט אחד, בלי לייפות, איך השלב נסגר, עם הסטטוס ועם הפלט של ההוכחה. אחר כך אומרים בשתי שורות שהשלב הבא הוא שפיכת הרעיון, ושפותחים אותו בשיחה חדשה עם `/blueprint`.
