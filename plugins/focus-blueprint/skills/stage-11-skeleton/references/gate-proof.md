# הוכחה שהשערים עובדים בפרויקט הזה

בכל מקום שכתוב `bp`, מריצים `node "${CLAUDE_PLUGIN_ROOT}/scripts/bp.mjs"`.

הבדיקות של הכלי מוכיחות שהשערים עובדים במחשב שבו הכלי נבנה. ההוכחה כאן נעשית במחשב של הסטודנט, בפרויקט שלו, עם הגרסאות של Claude Code, של Git ושל Node שמותקנות אצלו. לכל שער Claude כותב בכוונה הפרה אחת במקום זמני, בודק שהשער עוצר אותה, מוחק אותה ושומר את הפלט בקובץ `docs/evidence/gates.txt`. מריצים אותה בשלב 11, בכניסה לפרויקט קיים, ובכל פעם שהפרויקט עובר למחשב אחר, כי ההגדרה שמפעילה את ה-hook של git נשמרת רק בעותק המקומי של המאגר.

## כללים לכל ההרצה

- כששער עוצר פעולה, זו התוצאה שרצינו. לא מנסים את אותה פעולה בדרך אחרת. לא כותבים את הקובץ דרך ה-shell, לא מתקנים את ההפרה כדי שתעבור ולא עוברים לשרת MCP אחר.
- הסוד המזויף נבנה בזמן ההרצה מחלקים, ולכן אף מפתח לא כתוב בכלי. הערך שלו לא נכנס לשום קובץ, וגם לא להוכחה. בהוכחה כתוב רק שם התבנית שהשער זיהה.
- כל פקודה רצה לבד, בלי `&&`, בלי צינור ובלי הפניה לקובץ, כדי שאותן פקודות יעבדו ב-Bash, ב-PowerShell ובשורת הפקודה של Windows. כותבים קבצים בכלי Write, ומוחקים אותם עם `node -e`.
- בסוף לא נשאר בפרויקט שום דבר מההרצה מלבד קובץ ההוכחה.
- כששער נכשל, לא מחלישים אותו ולא עוקפים אותו כדי שההוכחה תעבור. רושמים את הכישלון, בודקים עם `/plugin` שהכלי מופעל, ואומרים לסטודנט בדיוק מה לא נעצר.

## לפני שמתחילים

1. בודקים עם `git branch --show-current` שעובדים בענף של השלב. על `main` לא מריצים את ההוכחה.
2. הפקודה `git status --porcelain` מחזירה פלט ריק. כשיש שינויים, עושים קודם commit לעבודה של השלב, באותו ענף.
3. הבדיקה `node scripts/blueprint-check.mjs` עוברת בלי שגיאות. כשיש שגיאות, מתקנים אותן קודם, כי אחרת אי אפשר לדעת מה עצר את ה-commit בשער השני.
4. הפקודה `git config --get core.hooksPath` מחזירה `.githooks`, והקובץ `.githooks/pre-commit` קיים. כשאחד מהם חסר, מריצים `bp githook install` ובודקים שוב.
5. רושמים את הענף ואת ה-commit הנוכחי, עם `git rev-parse --short HEAD`.

## השער הראשון: סוד בקובץ שנשלח לדפדפן

ה-hook שרץ לפני כל כתיבה של Claude לקובץ, `guard-secrets`, עוצר טקסט שיש בו סוד כשהקובץ נכנס ל-Git.

1. בודקים שהקובץ הזמני לא מוחרג מ-Git. הפקודה `git check-ignore -q blueprint-gate-proof.html` צריכה להיגמר בקוד 1. סוד בקובץ מוחרג מותר, ולכן כשהשם הזה מוחרג בפרויקט, בוחרים שם אחר שמסתיים ב-html, בודקים אותו באותה פקודה ומשתמשים בו בכל הצעדים של השער.
2. בונים את הסוד המזויף עם `node -e "console.log(['sb','secret',require('crypto').randomBytes(16).toString('hex')].join('_'))"`. הפלט נראה כמו מפתח סודי של Supabase, אבל הוא אקראי ולא שייך לשום חשבון.
3. מנסים לכתוב בכלי Write את הקובץ `blueprint-gate-proof.html` בשורש הפרויקט, עם השורה `<script>const key = "<הפלט>";</script>`.
4. מצפים לסירוב שמתחיל ב-`Blocked by Focus Blueprint` ומזכיר `Supabase secret key`.
5. בודקים שהקובץ לא נוצר, עם `node -e "console.log(require('fs').existsSync('blueprint-gate-proof.html'))"`, שצריכה להדפיס `false`. אם הקובץ נוצר בכל זאת, השער נכשל, ולכן מוחקים אותו עם `node -e "require('fs').rmSync('blueprint-gate-proof.html',{force:true})"` ורושמים כישלון.

## השער השני: מיגרציה שיוצרת טבלה בלי RLS

ה-hook של git לפני commit מריץ את בדיקת המפה, והבדיקה עוצרת טבלה שנוצרת בלי RLS.

השער רלוונטי כשיש בפרויקט תיקיית מיגרציות. בפקודות כתובה התיקייה `supabase/migrations`. בפרויקט שעוד שומר את המיגרציות ב-`db/migrations`, מגרסה קודמת של הכלי, משתמשים באותו שם קובץ בתיקייה הזאת. כשאין תיקיית מיגרציות, רושמים בהוכחה `na` ואת הסיבה.

1. כותבים בכלי Write את הקובץ `supabase/migrations/99999999999999_blueprint_gate_proof.sql`, עם שורה אחת: `create table public.blueprint_gate_proof (id bigint primary key);`.
2. ה-hook שרץ אחרי הכתיבה יחזיר ש-RLS חסר. זה צפוי, ולא מתקנים את הקובץ.
3. מריצים `git add -- supabase/migrations/99999999999999_blueprint_gate_proof.sql`.
4. מריצים `git commit -m "blueprint gate proof"`. מצפים לקוד יציאה שאינו 0, ולהודעה שמתחילה ב-`ה-commit נעצר` ומזכירה את `blueprint_gate_proof`.
5. מוציאים את הקובץ מהשינויים שמוכנים ל-commit, עם `git reset -q -- supabase/migrations/99999999999999_blueprint_gate_proof.sql`, ומוחקים אותו עם `node -e "require('fs').rmSync('supabase/migrations/99999999999999_blueprint_gate_proof.sql',{force:true})"`.
6. כשה-commit עבר, השער נכשל. מבטלים את ה-commit עם `git reset --soft HEAD~1`, מבצעים את צעד 5 ורושמים כישלון.

## השער השלישי: commit שמדלג על ה-hook

ה-hook שרץ לפני כל פקודת shell של Claude, `guard-shell`, עוצר פקודה שמנסה לדלג על ה-hook של git.

1. מריצים `git commit --no-verify --dry-run -m "blueprint gate proof"`. בגלל הדגל `--dry-run`, גם אם השומר לא יעצור את הפקודה, git לא ייצור commit.
2. מצפים לסירוב שמתחיל ב-`Blocked by Focus Blueprint` ומזכיר `--no-verify`.
3. בודקים ש-`git rev-parse --short HEAD` מחזיר את ה-commit שנרשם בהתחלה.

## השער הרביעי: שינוי ישיר במסד דרך ה-MCP של Supabase

ה-hook שרץ לפני כל כלי של Supabase MCP, `guard-migration`, עוצר כל כלי שמשנה את המסד, כי בפרויקט הזה המסד משתנה רק דרך קובץ מיגרציה ב-Git.

השער רלוונטי במסלול עם Supabase, כשה-MCP של הפרויקט מחובר. משתמשים רק בשרת של הפרויקט, זה שהכתובת שלו כוללת `project_ref`, ואף פעם לא בשרת שרואה את כל הפרויקטים בחשבון. במסלול בלי Supabase רושמים בהוכחה `na`. כשהשרת לא מחובר, רושמים `not-run` ואת הסיבה.

1. קוראים לכלי `execute_sql` של השרת, עם השאילתה `begin; create table public.blueprint_gate_proof (id bigint); rollback;`. בגלל ה-rollback, גם אם השומר לא יעצור את השאילתה, הטבלה לא תישאר במסד.
2. מצפים לסירוב שמתחיל ב-`Blocked by Focus Blueprint` ומזכיר `execute_sql runs only read-only SQL`.
3. בודקים שלא נשאר כלום, בשאילתת קריאה שהשומר מתיר: `select to_regclass('public.blueprint_gate_proof') as remains;`. התוצאה צריכה להיות null.

## בסוף ההרצה

1. הפקודה `git status --porcelain` שוב מחזירה פלט ריק, ו-`git rev-parse --short HEAD` מחזיר את ה-commit שנרשם בהתחלה.
2. כותבים בכלי Write את `docs/evidence/gates.txt`, בתבנית שלמטה. לכל שער יש תוצאה אחת: `pass` כשהשער עצר, `fail` כשהוא לא עצר, `na` כשהשער לא קיים במסלול הזה ו-`not-run` כשהוא קיים אבל לא היה אפשר להריץ אותו. ליד `na` ו-`not-run` כותבים את הסיבה.
3. ה-commit של השלב כולל את קובץ ההוכחה. כששער אחד לא קיבל `pass` או `na`, השלב נסגר כ-`done_with_concerns`, והשער שנשאר פתוח כתוב בהערה.

```text
# blueprint gates 2026-11-25T10:00:00Z
branch: stage-11
commit: 1a2b3c4

gate 1: secret in a client file (PreToolUse, guard-secrets)
tried: Write blueprint-gate-proof.html with a fake Supabase secret key built at runtime
got: Blocked by Focus Blueprint: the text for blueprint-gate-proof.html contains a Supabase secret key ...
result: pass
cleanup: blueprint-gate-proof.html does not exist

gate 2: migration that creates a table without RLS (git pre-commit)
tried: git commit with supabase/migrations/99999999999999_blueprint_gate_proof.sql staged
got: exit 1, ה-commit נעצר ... blueprint_gate_proof ...
result: pass
cleanup: file unstaged and deleted

gate 3: commit that skips the hook (PreToolUse, guard-shell)
tried: git commit --no-verify --dry-run
got: Blocked by Focus Blueprint: git commit --no-verify (or -n) skips the commit gate ...
result: pass
cleanup: HEAD unchanged

gate 4: direct SQL change through the Supabase MCP (PreToolUse, guard-migration)
tried: execute_sql with a create table inside begin and rollback
got: Blocked by Focus Blueprint: execute_sql runs only read-only SQL ...
result: pass
cleanup: to_regclass returned null

summary: 4 pass, 0 fail, 0 na, 0 not-run
after: git status is clean, HEAD is 1a2b3c4
```

<!-- בתבנית אין מירכאות ואין ערך של סוד, כדי שהקובץ עצמו לא ייראה לסורק כמו סוד. בשורות got מעתיקים את ההתחלה של ההודעה שהתקבלה בפועל. -->
