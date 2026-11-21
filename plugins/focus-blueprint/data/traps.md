# מלכודות ידועות

בדקנו את הרשימה ב-2026-11-21. לכל מלכודת יש מקור רשמי, או שכתוב לידה שגילינו אותה בהרצות שלנו.

- דפדפן אוטומטי לא עובר את שער Turnstile. שער האימות של Cloudflare מזהה דפדפן שנשלט ב-Playwright וחוסם אותו, ולכן בדיקה אוטומטית של טופס שיש בו שער כזה נתקעת. גילינו את זה בהרצות שלנו. הסבר על השער: https://developers.cloudflare.com/turnstile/
- בתוכנית החינמית של GitHub, חסימת מיזוג לא נאכפת ב-repo פרטי. בתוכנית החינמית הגנת ענפים זמינה רק ב-repo ציבורי, וב-repo פרטי היא זמינה רק בתוכניות בתשלום. מקור: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- התוכנית Hobby של Vercel מיועדת לשימוש אישי או לא מסחרי. כך כתוב בתנאי השירות, ולכן אתר של עסק צריך תוכנית בתשלום. מקור: https://vercel.com/legal/terms (סעיף Hobby)
- בתוכנית החינמית של Supabase אפשר להחזיק שני פרויקטים פעילים. פרויקט שהייתה בו מעט פעילות במשך שבעה ימים עלול להיעצר, ואפשר להפעיל אותו שוב מהדשבורד. מקורות: https://supabase.com/docs/guides/platform/billing-faq ו-https://supabase.com/docs/guides/deployment/going-into-prod
- כשיש CLAUDE.md בשורש, Claude Code קורא אותו ולא את AGENTS.md. ההוראות ב-AGENTS.md נטענות רק אם מייבאים אותן מתוך CLAUDE.md. מקור: https://code.claude.com/docs/en/memory
- ב-Claude Code, פקודת shell אחת יכולה לרוץ לכל היותר 10 דקות. זו ברירת המחדל של התקרה שהמודל יכול לקבוע, ולכן תהליך ארוך צריך לרוץ ברקע. מקור: https://code.claude.com/docs/en/env-vars (BASH_MAX_TIMEOUT_MS)
- כשה-sandbox פועל, פקודה עלולה לא להגיע לשרת מקומי. שרת פיתוח שרץ על המחשב לא תמיד נגיש לבדיקה מתוך ה-sandbox, ובמק ראינו את זה בהרצות שלנו. מקור: https://code.claude.com/docs/en/sandboxing

## Compatibility runs

- בהרצה מיום 2026-11-21 עם superpowers 7.0.2 הכול עבר, וכללי הפרויקט נשמרו. ה-brainstorming של superpowers עדיין מתחיל בתיקייה בלי הכלי, ובשלב הבנייה הופעל רק systematic-debugging.
