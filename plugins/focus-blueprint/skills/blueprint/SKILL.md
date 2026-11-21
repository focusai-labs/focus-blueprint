---
name: blueprint
description: Entry command of Focus Blueprint, the idea-to-system process. Reads the project's state file and tells the user which stage the project is at and what comes next. Use when the user runs /blueprint or asks where the project stands in the Blueprint process.
---

# Focus Blueprint: entry command

This is the walking skeleton of the entry command. It proves one thing: a new conversation picks the project up from its files, not from an earlier conversation.

## What to do

1. Read `.blueprint/state.json` in the project root with the Read tool. The file is the source of truth for the stage, whatever earlier messages said.
2. If the file does not exist, tell the user in one sentence that this folder is not a Blueprint project yet, and stop. Do not create the file.
3. If it exists, answer in Hebrew in three short lines:
   - the chapter and the stage, as a number out of 15 with its name from the table below
   - the status of the stage, from the `status` field
   - the stage that comes next
4. Do nothing else: no edits and no commands.

Every line of the answer opens with a Hebrew word, so it reads right to left.

## The stages

| Stage | Chapter | Name |
|---|---|---|
| 1 | להבין | בדיקת חיבורים |
| 2 | להבין | שפיכת הרעיון |
| 3 | להבין | שאלון |
| 4 | להבין | מסמך PRD ובחירת מסלול |
| 5 | להבין | מפת מסכים |
| 6 | לראות | כיוון עיצובי |
| 7 | לראות | בניית ה-mockup |
| 8 | לראות | הצגה לאדם אמיתי |
| 9 | לבנות | סריקת מלאי |
| 10 | לבנות | נתונים והרשאות |
| 11 | לבנות | שלד חי |
| 12 | לבנות | יכולת אחרי יכולת |
| 13 | להשיק | רשימת השקה |
| 14 | להשיק | סליקה |
| 15 | להשיק | מסירה |
