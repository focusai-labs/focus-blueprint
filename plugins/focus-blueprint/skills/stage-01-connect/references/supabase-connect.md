# חיבור Supabase

החלק הזה רץ פעם אחת במסלול של אפליקציה עם משתמשים, בתחילת שלב 10 ולפני הטבלה הראשונה. שלב 10 מפנה לכאן, ולכן לא מריצים כאן `bp stage start` או `bp stage done`. לכל צעד יש בקובץ `${CLAUDE_PLUGIN_ROOT}/data/tracks/supabase-app.json` כוונה, קישור לתיעוד, שורת בטיחות והוכחה, ולפני כל פקודה של Supabase קוראים את העמוד הרשמי דרך `/focus-blueprint:docs-verify`.

בכל מקום שכתוב `bp`, מריצים `node "${CLAUDE_PLUGIN_ROOT}/scripts/bp.mjs"`.

## איך מובילים את הסטודנט

לא מניחים שהסטודנט יודע לבד איך מחברים את Supabase ל-GitHub. כל פעולה שצריכה את הידיים שלו בדפדפן עוברת כך:

1. קודם קוראים את העמוד הרשמי דרך `docs-verify`, ולא מסתמכים על הזיכרון.
2. נותנים פעולה אחת בכל פעם. אומרים איפה ללחוץ ומה הוא אמור לראות אחרי הלחיצה, ומשתמשים במילים שמופיעות על המסך.
3. מחכים שהסטודנט יאשר שזה מה שהוא רואה, ורק אז נותנים את הפעולה הבאה. כשהמסך שונה מהתיעוד, מבקשים ממנו לתאר מה מופיע ובודקים שוב בתיעוד, בלי לנחש.
4. בסוף מריצים בדיקה אחת שמוכיחה שהחיבור עובד.

כל מה ש-Claude יכול לעשות בעצמו בטרמינל, עם `supabase`, `gh` או `claude`, הוא עושה בעצמו. מהסטודנט מבקשים רק את מה שצריך את הידיים שלו בדפדפן או בחשבון שלו.

## הסדר

1. קודם בוחרים תוכנית ופותחים פרויקט, לפי הצעד `sb-create-project`. קוראים במפה את השירות `supabase`, ובמיוחד את `plan` ואת `planReason`, ומתחילים ממה שהפרויקט צריך. מערכת עם משתמשים אמיתיים צריכה גיבוי יומי, פרויקט שלא נעצר בגלל חוסר פעילות ובדיקה של כל מיגרציה בענף לפני המיזוג, ולכן ממליצים על Pro. כשהסטודנט או הלקוח בוחרים להישאר בתוכנית החינמית, מוסיפים את הבקרות שבשדה `onFree` של כל צעד, ורושמים כל פער ואת הסיכון שלו עם `bp ruling add`. פתיחת פרויקט עולה כסף או תופסת מקום בתוכנית, ולכן שואלים לפני. הסטודנט פותח את הפרויקט בלוח הבקרה, ו-Claude מוביל אותו.
2. אחר כך Claude מתקין ברמת הפרויקט את שני התוספים הרשמיים של Supabase, לפי הצעד `sb-skills`:

   ```
   claude plugin marketplace add supabase/agent-skills --scope project
   claude plugin install supabase@supabase-agent-skills --scope project
   claude plugin install postgres-best-practices@supabase-agent-skills --scope project
   ```

   את התוסף המשולב `supabase-community/supabase-plugin` לא מתקינים, כי הוא מוסיף שרת MCP מלא בלי `project_ref`. כל אחד משני התוספים הרשמיים מוסיף שרת שמחפש רק בתיעוד, עם `features=docs`, וזה בסדר.
3. עכשיו Claude מתקין את ה-CLI לפי מערכת ההפעלה, לפי הצעד `sb-cli` והעמוד https://supabase.com/docs/guides/local-development/cli/getting-started. ב-macOS משתמשים ב-Homebrew, ב-Windows ב-Scoop וב-Linux ב-Homebrew או בחבילות מעמוד השחרורים. בכל מערכת אפשר גם `npm install supabase --save-dev`, ואז מריצים `npx supabase`. בודקים ש-`supabase --version` מתחיל ב-3, ומריצים `supabase init`, שיוצר את `supabase/config.toml` בלי להתחבר לשום חשבון.
4. הסטודנט מריץ בעצמו, בחלון טרמינל רגיל, את `supabase login` ואחריו את `supabase link <ref>`. הפקודה הראשונה פותחת דפדפן, והשנייה שואלת את סיסמת המסד. Claude לא מבקש את הסיסמה או את הטוקן. אחר כך Claude רושם במפה `bp service set supabase --json '{"ref":"<ref>","prodBranch":"main","devTarget":null}'`, או `bp service add supabase --json '{"name":"Supabase","ref":"<ref>","prodBranch":"main","devTarget":null}'` כשהשירות עוד לא במפה, ומריץ `bp state set where.supabaseRef=<ref>`. לפני ההשקה הפרויקט המקושר הוא גם מסד הפיתוח, ולכן `devTarget` נשאר ריק עד שלב 13.
5. אחרי הקישור Claude כותב בשורש הפרויקט את `.mcp.json`, לפי הצעד `sb-mcp`:

   ```json
   {
     "mcpServers": {
       "supabase": {
         "type": "http",
         "url": "https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true&features=database,debugging,development,docs"
       }
     }
   }
   ```

   הפרמטרים ושמות הקבוצות לקוחים מ-https://supabase.com/docs/guides/getting-started/mcp. הקבוצות האלה נותנות את הטבלאות, את המיגרציות ושאילתות קריאה, את ה-advisors והלוגים, את הכתובת והמפתח הציבורי של הפרויקט ואת החיפוש בתיעוד. אחר כך Claude מריץ `claude mcp list`. כשמופיע שרת של Supabase בלי `project_ref`, עם `ref` של פרויקט אחר, או בלי `read_only=true` (בחבילה: `--project-ref=` ו-`--read-only`), חוץ משרתי התיעוד, עוצרים, כי השרת הזה יכול לשנות פרויקט אחר או לכתוב בפרויקט הזה. הסטודנט מכבה אותו לפרויקט הזה דרך `/mcp`, ו-Claude בודק שוב. בסוף אומרים לסטודנט שבשיחה הבאה Claude Code יבקש לאשר את השרת החדש, ושאחרי האישור מתחברים אליו דרך `/mcp`.
6. בשלב הבא Claude פותח מ-main ענף בשם `supabase-connect` ויוצר את המיגרציה הראשונה עם `supabase migration new rls_auto_enable`. לתוכה הוא מעתיק את טריגר האירוע שמפעיל RLS, מ-https://supabase.com/docs/guides/database/postgres/event-triggers. את המיגרציה הזאת לא דוחפים ביד, כי היא תוכיח שהאינטגרציה עובדת. ב-commit נכנסים `supabase/config.toml`, המיגרציה, `.mcp.json` ו-`.claude/settings.json`, ובודקים ש-`supabase/.temp` לא נכנס אליו.
7. הסטודנט מחבר את האינטגרציה עם GitHub בלוח הבקרה של Supabase, לפי הצעד `sb-github`, ו-Claude מוביל אותו לפי https://supabase.com/docs/guides/deployment/branching/github-integration. הוא נותן ל-Supabase הרשאה ב-GitHub, בוחר את המאגר, כותב `.` בתיקיית העבודה ומדליק את Deploy to production. בתוכנית Pro, לפי הצעד `sb-branching`, הוא מדליק גם את Automatic branching ומשאיר כבוי את Supabase changes only.
8. בסוף Claude דוחף את הענף ופותח PR עם `gh pr create`. בתוכנית Pro הוא מחכה שהבדיקה Supabase Preview תופיע ותעבור, עם `gh pr checks`. אחר כך, באישור הסטודנט, הוא מוסיף אותה לכלל של main. את המספר של הכלל מוצאים עם `gh api "repos/{owner}/{repo}/rulesets"`, ומריצים `gh api "repos/{owner}/{repo}/rulesets/<id>" --method PUT --input "${CLAUDE_PLUGIN_ROOT}/templates/github/ruleset-main-supabase.json"`. כשהבדיקות ירוקות, ממזגים ומחכים לסוף ההעלאה. ההוכחה היא שהפקודה `supabase migration list --remote` מראה את המיגרציה הראשונה בפרויקט המקושר, אף שאף אחד לא דחף אותה ביד. בתוכנית החינמית רושמים את הפער של הענפים, לפי השדה `onFree` של הצעד `sb-branching`.
9. כשהכול עובד, Claude מריץ `bp connections set supabase ok=true note="<ref>, <plan>, ענפים <כן או לא>"`, ואחר כך `git switch main` ו-`git pull`. שלב 10 ממשיך מכאן בענף `stage-10`.

## מה חייב להיות נכון בסוף

- הפקודה `claude plugin list` מראה את `supabase@supabase-agent-skills` ואת `postgres-best-practices@supabase-agent-skills`.
- הפקודה `supabase --version` מתחילה ב-3, והקובץ `supabase/.temp/project-ref` מחזיק את ה-ref שרשום במפה.
- בקובץ `.mcp.json` יש שרת אחד של Supabase עם `project_ref`, עם `read_only=true` ועם ארבע הקבוצות. הפקודה `claude mcp list` לא מראה שרת פעיל של Supabase לפרויקט אחר, בלי `project_ref` או שיכול לכתוב, חוץ משרתי תיעוד.
- הפקודה `supabase migration list --remote` מראה את המיגרציה הראשונה, שהגיעה לשם רק דרך המיזוג.
- בתוכנית Pro, הפקודה `gh api "repos/{owner}/{repo}/rules/branches/main"` מראה את הבדיקות `check` ו-Supabase Preview. בתוכנית החינמית יש הכרעה רשומה על הפער.
