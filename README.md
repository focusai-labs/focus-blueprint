# Focus Blueprint

הכלי Focus Blueprint הוא תוסף ל-Claude Code שמלווה מוצר מהרעיון ועד מערכת שעובדת באוויר, ב-15 שלבים: אפיון, mockup, נתונים והרשאות, בנייה של יכולת אחרי יכולת, השקה ומסירה. בנינו אותו לסטודנטים בקורס AI Dev של Focus AI, שבונים עם Claude Code גם בלי רקע בתכנות. בכל שלב Claude עובד לפי הוראות קבועות, ובסוף השלב יש הוכחה שמה שנבנה באמת עובד.

## התקנה

<!-- השמות של המאגר, של ה-marketplace ושל התוסף נמצאים רק בטבלה ובפקודות שמתחתיה. כשהם משתנים, מעדכנים רק את הסעיף הזה. -->

| מה | השם |
|---|---|
| המאגר של ה-marketplace ב-GitHub | `focusai-labs/focus-blueprint` |
| השם של ה-marketplace | `focus-ai` |
| התוסף | `focus-blueprint@focus-ai` |

מתקינים מהטרמינל:

```
claude plugin marketplace add focusai-labs/focus-blueprint
claude plugin install focus-blueprint@focus-ai
```

אפשר גם מתוך שיחה ב-Claude Code:

```
/plugin marketplace add focusai-labs/focus-blueprint
/plugin install focus-blueprint@focus-ai
```

התוסף נטען בשיחה הבאה, או מיד אחרי `/reload-plugins`. כדי לעדכן אותו מריצים `claude plugin update focus-blueprint@focus-ai`. ב-marketplace שאינו של Anthropic העדכון האוטומטי כבוי, ומפעילים אותו ב-`/plugin`, בלשונית Marketplaces. ההסבר המלא נמצא ב-https://code.claude.com/docs/en/discover-plugins.

אחרי עדכון של התוסף מריצים `bp update` פעם אחת בכל פרויקט, כדי שהבודק שבתוך הפרויקט יתעדכן לגרסה החדשה.

כדי להתחיל, פותחים תיקייה ריקה ב-Claude Code וכותבים `/blueprint`. בפעם הראשונה הכלי מציג את תנאי השימוש, מתוך `plugins/focus-blueprint/TERMS.md`, ומבקש אישור. בשלב 1 הכלי בודק שיש במחשב Node.js בגרסה 22 ומעלה, Git ו-GitHub CLI מחובר.

## מה מנחה ומה חוסם

חלק מהרכיבים של הכלי מנחים את Claude, וחלק עוצרים אותו. הנחיה עובדת ברוב המקרים, אבל Claude יכול לפספס אותה. רכיב שחוסם עוצר את הפעולה גם כשההנחיה פוספסה, ולכן כל כלל חשוב נאכף גם ברכיב כזה.

| הרכיב | מנחה או חוסם | מה בדיוק |
|---|---|---|
| הסקילים של השלבים ושל הטכניקות | מנחים | אומרים ל-Claude מה עושים בכל שלב ומה מוכיח שהשלב נגמר |
| הכללים שהכלי מוסיף ל-AGENTS.md | מנחים | הסדר בין המקורות, ארבע העצירות ודרך העבודה ב-Git |
| הסקילים הרשמיים של Supabase | מנחים | העובדות על Supabase, כמו ה-API, מלכודות האבטחה והדגלים של ה-CLI |
| ההקשר בתחילת שיחה ובכל הודעה | מנחה | השלב הנוכחי ומה מחכה לסטודנט |
| הבדיקה של קובצי מיגרציה אחרי עריכה | מנחה | מחזירה ל-Claude את הממצאים ולא עוצרת. בדיקת המפה וה-commit הם שחוסמים |
| ה-hook על פקודות בטרמינל | חוסם | commit או מיזוג ישר על main, דחיפה בכוח ל-main, דחיפה של קובץ סודות ודילוג על השער המקומי. אחרי ההשקה הוא חוסם גם `supabase db push` לפרודקשן, ובכל זמן `db reset` או `migration repair` מרחוק |
| ה-hook על כלי ה-MCP של Supabase | חוסם | כל כלי שמשנה פרויקט מרוחק, כמו `apply_migration`, פקודת DDL דרך `execute_sql`, פריסה של פונקציה ופעולות על ענפים ועל פרויקטים. כלי קריאה נשארים פתוחים |
| ה-hook על כתיבת קבצים | חוסם | סוד שנכנס לקובץ ש-Git עוקב אחריו |
| בדיקת המפה בסוף תשובה | חוסמת | Claude לא מסיים לענות כשהמפה והקבצים לא מתאימים |
| השער המקומי לפני commit | חוסם | הפקודה `bp init` מתקינה אותו, והוא מריץ את בדיקת המפה לפני כל commit |
| הבדיקה ב-CI | חוסמת | הבדיקה `check` מריצה את בדיקת המפה על כל PR ל-main |
| הכלל של GitHub על main | חוסם | מיזוג רק דרך PR ורק כשהבדיקות עוברות. במאגר פרטי זה דורש GitHub Pro, GitHub Team או GitHub Enterprise Cloud |
| הבדיקה Supabase Preview | חוסמת | בתוכנית Pro של Supabase, מיזוג של מיגרציה שנכשלת בענף התצוגה |

## מה יש במאגר

- בתיקייה `plugins/focus-blueprint` נמצא התוסף עצמו, עם הסקילים, ה-hooks, הסקריפטים, הנתונים והתבניות.
- בתיקייה `test` נמצאות הבדיקות, ומריצים אותן עם `node --test 'test/**/*.test.mjs'`.
- הקובץ `.claude-plugin/marketplace.json` מגדיר את ה-marketplace.
