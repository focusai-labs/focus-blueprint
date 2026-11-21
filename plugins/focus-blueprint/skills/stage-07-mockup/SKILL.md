---
name: stage-07-mockup
description: שלב 07 של Focus Blueprint. Claude בונה את כל המסכים ב-HTML על מוק דאטה, מעלה אותם לקישור, ושואל את הסבב השלישי מול המסכים. השלב נסגר רק כשכל העקרונות המחייבים בסקירת ה-UX עוברים. מריצים אחרי שלב 6.
model: sonnet
disable-model-invocation: true
---

# שלב 07: בניית ה-mockup

בכל מקום שכתוב `bp`, מריצים `node "${CLAUDE_PLUGIN_ROOT}/scripts/bp.mjs"`.

## למה השלב הזה קיים

מסך עולה היום דקות, ולכן ה-mockup הוא חלק מהאפיון, ולא מהבנייה. מול מסך אמיתי אפשר לשאול את השאלות שבתיאור נשארות באוויר: מה קורה כשלוחצים, מי רואה מה, ומה קורה כשמשהו נכשל. מסד הנתונים עוד לא קיים, ולכן כל תשובה עולה דקה ולא יום.

## מה קוראים לפני שמתחילים

- בקובץ המצב `.blueprint/state.json`, השלב הנוכחי הוא 7. אם לא, מפנים ל-`/blueprint`.
- המפה `.blueprint/map.json`, ובה רשימת המסכים, והמסמכים `spec/screens-map.md`, `spec/journeys.md` ו-`design/design-system.md`.
- בעקרונות `${CLAUDE_PLUGIN_ROOT}/data/ux/principles.json`, כל מה שמסומן לשלב 7, לפני שבונים מסך אחד.
- הכללים לבניית מסך, בקובץ `${CLAUDE_PLUGIN_ROOT}/skills/stage-07-mockup/references/mockup-rules.md`.

## מה עושים

1. מריצים `bp stage start 7`.
2. כותבים קובץ מוק דאטה אחד, `mockup/mock-data.js`, עם נתונים שנראים אמיתיים ובלי פרטים של אנשים אמיתיים, וקובץ עיצוב אחד, `mockup/mock.css`, שטוען את `design/tokens.css`.
3. בונים כל מסך שבמפה, בקובץ שרשום לו. כל מסך עומד בכללים שבקובץ הכללים: כיוון מימין לשמאל, פעולה ראשית אחת, אישור לפני מחיקה, דרך חזרה לבית, תווית לכל שדה, שגיאה ליד השדה, מצב טעינה, ושמירה של טיוטות.
4. אם הוחלט על תשלום, משאירים במסכים את המקום שלו, עם כפתור שמסומן כדמה.
5. מעלים את התיקייה `mockup` ל-Vercel כקישור, לפי שלב ה-mockup במסלול שבקבצים `${CLAUDE_PLUGIN_ROOT}/data/tracks`. קוראים את התיעוד דרך `/focus-blueprint:docs-verify` לפני הפקודה. רושמים את הקישור: `bp state set where.mockupUrl=<url>`.
6. שואלים את הסבב השלישי מול המסכים: `node "${CLAUDE_PLUGIN_ROOT}/ui/serve.mjs" --page questionnaire --round c`. לכל מסך עונים על השאלות שלו, מול הקישור. כל תשובה שמשנה מסך מתוקנת מיד, וכל תשובה שמשנה את האפיון נכנסת ל-PRD ולמסמך ההחלטות.
7. מריצים את `/focus-blueprint:ux-review` על כל המסכים. כל עיקרון ברמה `must` שנכשל מתוקן, ומריצים שוב עד שהכל עובר. עיקרון ברמה `should` שלא מתקנים עכשיו נכנס לרשימת "אחר כך" עם הסיבה.

## מה חייב להיות נכון בסוף (ההוכחה)

- כל קובץ מסך שרשום במפה קיים בתיקייה `mockup`.
- בקובץ `spec/ux-review.md` אין אף עיקרון `must` שנכשל.
- הפקודה `bp state get where.mockupUrl` מחזירה קישור שנפתח.
- הבדיקה `node scripts/blueprint-check.mjs` עוברת את כללים 1 ו-2.

## מה נשאר בתיקייה

- כל המסכים בתיקייה `mockup`, יחד עם `mock-data.js` ו-`mock.css`
- דוח הסקירה `spec/ux-review.md`, ותשובות הסבב השלישי במסמך ההחלטות

## סגירה

1. מריצים את בדיקות ההוכחה, ושומרים את הפלט האמיתי.
2. מציגים את ההכרעות של השלב: `bp ruling list --unreported --stage 7`, ואז `bp ruling report --stage 7`.
3. סוגרים: `bp stage done 7 --status <done|done_with_concerns|blocked|needs_context> --note "<מה פתוח>" --proof "<הפלט>"`. עיקרון `should` שנדחה הופך את הסטטוס ל-`done_with_concerns`.
4. עושים commit בענף `stage-07` עם הודעה בעברית, PR, ומיזוג אחרי שהבדיקה עוברת.
5. כותבים את `.blueprint/last-session.md`.
6. אומרים לסטודנט בשורה אחת כנה איך השלב נסגר, עם הקישור ל-mockup. אחר כך שתי שורות: הבא בתור הוא אדם אמיתי מול ה-mockup, בשיחה חדשה עם `/blueprint`.
