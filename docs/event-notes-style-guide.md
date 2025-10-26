### Style guide: event notes for 1127–1142 (card ideation)

- **format**: Use JSON Lines (one JSON object per line). Nested fields and arrays are required; avoid CSV.
- **scope**: Only record events dated 1127–1142. If the exact date is unclear, include the dynasty era string and set precision.
- **granularity**: Capture atomic events (one decision/battle/edict/uprising/logistic action). Split long passages into multiple records.
- **neutrality**: Summarize factually; reserve game effects for notes.

- **ids**: `song|jin-YYYY-<short-slug>` (e.g., `song-1127-yingtian-enthronement`). Lowercase, hyphenated, stable.

- **dates**:
  - **date.iso_start** / **date.iso_end**: YYYY-MM-DD where known; else year-only (YYYY).
  - **date.era**: Original reign notation (e.g., "建炎元年五月庚寅").
  - **date.precision**: one of "day" | "month" | "season" | "year" | "range" | "unknown".

- **places**:
  - **places.primary**: canonical toponyms with Chinese and pinyin; type "city|prefecture|fort|river|mountain|region".
  - **places.other**: supporting locations in the same event.
  - Maintain a separate gazetteer for canonicalization (dedupe aliases), to be used to build the map later.

- **actors**:
  - List key individuals/factions with **name_zh**, **name_en_or_pinyin**, **role**, **side** ("Song" | "Jin" | "Other").

- **categories/tags**:
  - At least one of: "politics", "court", "diplomacy", "economy", "finance", "logistics", "law", "religion", "military", "naval", "fortification", "intrigue", "disaster".
  - Add campaign tags if relevant (e.g., "Jingkang", "Early Shaoxing").

- **summary**:
  - One or two sentences in English; no speculation. Keep under 40 words.

- **excerpt_zh**:
  - Short Chinese quote (≤200 chars) that evidences the event; preserve traditional characters and punctuation.

- **sources**:
  - Include each consulted source as: **work** ("songshi" | "jinshi"), **chapter_title** (zh and en), **url**, **note** (optional).
  - Examples: Songshi index [chinesenotes.com/songshi.html](https://chinesenotes.com/songshi.html), Jinshi index [chinesenotes.com/jinshi.html](https://chinesenotes.com/jinshi.html), chapter page (e.g., [Songshi 24](https://chinesenotes.com/songshi/songshi024.html)).

- **design_notes**:
  - Brief card hooks (title ideas, levers like "Handsize", "Tax", "Mobilize", "Edge control"), prerequisites, and potential outcomes. Keep separate from factual summary.

- **confidence/review**:
  - **confidence**: "high|medium|low". **review_status**: "draft|reviewed".

- **language & romanization**:
  - Chinese: Traditional (as in source). Pinyin for names and places (no tones); English exonym if widely used (e.g., "Kaifeng (開封, Kaifeng)").

- **de-duplication**:
  - If multiple entries cover the same event from different chapters, cross-reference by **duplicates** array of **id**s.

- **out-of-scope**:
  - If an important antecedent/prelude <1127 is required for context, cite it in **notes** but do not create a main event record.

JSON template (copy for each event)
```json
{
  "id": "song-1127-yingtian-enthronement",
  "work": "songshi",
  "chapter_title": {
    "zh": "卷二十四 本紀第二十四 高宗一",
    "en": "Volume 24 Annals 24: Gaozong 1"
  },
  "url": "https://chinesenotes.com/songshi/songshi024.html",
  "date": {
    "iso_start": "1127-05-01",
    "iso_end": "1127-05-31",
    "era": "建炎元年五月",
    "precision": "month"
  },
  "places": {
    "primary": {
      "name_zh": "應天府",
      "name_pinyin": "Yingtian Fu",
      "type": "prefecture"
    },
    "other": []
  },
  "actors": [
    { "name_zh": "高宗", "name_en_or_pinyin": "Gaozong (Zhao Gou)", "role": "emperor", "side": "Song" }
  ],
  "categories": ["politics", "court", "legitimacy"],
  "tags": ["Jianyan", "enthronement"],
  "summary_en": "Gaozong accepts the Mandate at Yingtian, proclaims the Jianyan era, and issues broad amnesties and administrative resets.",
  "excerpt_zh": "五月庚寅朔，帝登壇受命，… 改元建炎。大赦…",
  "sources": [
    {
      "work": "songshi",
      "chapter_title_zh": "卷二十四 本紀第二十四 高宗一",
      "chapter_title_en": "Volume 24 Annals 24: Gaozong 1",
      "url": "https://chinesenotes.com/songshi/songshi024.html",
      "note": "Enthronement and Jianyan proclamation."
    }
  ],
  "design_notes": "Card hook: 'Jianyan Restoration' — political stabilization; unlocks southern recruitment and administration bonuses.",
  "confidence": "high",
  "review_status": "draft",
  "duplicates": []
}
```

- **file organization**:
  - Store events in `data/events-1127-1142.jsonl`.
  - Maintain a gazetteer in `data/gazetteer.json` with canonical place records and aliases.

- **citations reminder**:
  - Always include a working chapter URL. Prefer the chapter page (e.g., Songshi 24 [link](https://chinesenotes.com/songshi/songshi024.html)) and the collection index for quick navigation ([Songshi index](https://chinesenotes.com/songshi.html), [Jinshi index](https://chinesenotes.com/jinshi.html)).


