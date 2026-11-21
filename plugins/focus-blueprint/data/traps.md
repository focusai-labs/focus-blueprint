# מלכודות ידועות

הרשימה נבדקה ב-2026-11-21. לכל מלכודת יש מקור רשמי, או סימון שהיא התגלתה בהרצות שלנו.

- **דפדפן אוטומטי לא עובר שער Turnstile.** שער אימות של Cloudflare מזהה דפדפן שנשלט ב-Playwright וחוסם אותו, ולכן בדיקה אוטומטית של טופס עם שער כזה נתקעת. מקור: התגלה בהרצות שלנו. רקע על השער: https://developers.cloudflare.com/turnstile/
- **חסימת מיזוג לא נאכפת ב-repo פרטי בתוכנית החינמית של GitHub.** הגנת ענפים זמינה ב-repo ציבורי בתוכנית החינמית, וב-repo פרטי רק בתוכניות בתשלום. מקור: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- **התוכנית Hobby של Vercel מיועדת לשימוש אישי ולא מסחרי.** תנאי השירות מגבילים אותה לשימוש כזה, ולכן אתר שמרוויח כסף צריך תוכנית בתשלום. מקור: https://vercel.com/legal/terms (סעיף Hobby)
- **בתוכנית החינמית של Supabase מותרים שני פרויקטים פעילים.** פרויקט עם פעילות נמוכה במשך שבעה ימים עלול להיעצר, ואפשר להחזיר אותו מהדשבורד. מקורות: https://supabase.com/docs/guides/platform/billing-faq ו-https://supabase.com/docs/guides/deployment/going-into-prod
- **כש-CLAUDE.md קיים בשורש, Claude Code קורא אותו במקום את AGENTS.md.** ההוראות ב-AGENTS.md לא נטענות אלא אם מייבאים אותן מתוך CLAUDE.md. מקור: https://code.claude.com/docs/en/memory
- **בפקודת shell בודדת ב-Claude Code התקרה היא עשר דקות.** זו ברירת המחדל של התקרה שהמודל יכול לקבוע, ולכן תהליך ארוך צריך לרוץ ברקע. מקור: https://code.claude.com/docs/en/env-vars (BASH_MAX_TIMEOUT_MS)
- **כשהמעטפת המבודדת פועלת, פקודה עלולה לא להגיע לשרת מקומי.** שרת פיתוח שנפתח על המחשב לא תמיד נגיש לבדיקה מתוך הסביבה המבודדת, ובמק זה ראינו אותה בהרצות שלנו. מקור: https://code.claude.com/docs/en/sandboxing והמקרה במק התגלה בהרצות שלנו

## Compatibility runs

- הרצה מיום 2026-11-21 עם superpowers 7.0.2: עבר. כללי הפרויקט נשמרו. ה-brainstorming של superpowers עדיין מתחיל בתיקייה בלי הכלי. בשלב בנייה הופעל רק systematic-debugging.
