.PHONY: help scrape-songshi scrape-jinshi scrape-url headings-songshi headings-jinshi sort-events

# Directory to write chapter scrapes and heading indexes
SCRAPE_DIR ?= data/scrapes

# Chapter number for scrape-songshi / scrape-jinshi, e.g. 369 or 024
CHAP ?= 369

# URL for scrape-url target, e.g. https://chinesenotes.com/songshi/songshi369.html
URL ?=

help:
	@echo ""
	@echo "Useful targets:"
	@echo "  make scrape-songshi CHAP=369     # Scrape Songshi chapter to $$(SCRAPE_DIR)/songshi369.json"
	@echo "  make scrape-jinshi CHAP=77       # Scrape Jinshi chapter to $$(SCRAPE_DIR)/jinshi77.json"
	@echo "  make scrape-url URL=<chapterUrl> # Scrape any chapter URL to $$(SCRAPE_DIR)/<basename>.json"
	@echo "  make headings-songshi            # Fetch Songshi index headings to $$(SCRAPE_DIR)/songshi-headings.json"
	@echo "  make headings-jinshi             # Fetch Jinshi index headings to $$(SCRAPE_DIR)/jinshi-headings.json"
	@echo "  make sort-events                 # Sort and normalize data/events-1127-1142.jsonl in-place"
	@echo ""

scrape-songshi:
	@mkdir -p "$(SCRAPE_DIR)"
	@echo "Scraping Songshi chapter $(CHAP) ..."
	@node scripts/scrapeChapter.mjs "https://chinesenotes.com/songshi/songshi$(CHAP).html" > "$(SCRAPE_DIR)/songshi$(CHAP).json"
	@echo "Wrote $(SCRAPE_DIR)/songshi$(CHAP).json"

scrape-jinshi:
	@mkdir -p "$(SCRAPE_DIR)"
	@echo "Scraping Jinshi chapter $(CHAP) ..."
	@node scripts/scrapeChapter.mjs "https://chinesenotes.com/jinshi/jinshi$(CHAP).html" > "$(SCRAPE_DIR)/jinshi$(CHAP).json"
	@echo "Wrote $(SCRAPE_DIR)/jinshi$(CHAP).json"

scrape-url:
	@test -n "$(URL)" || (echo "ERROR: provide URL=<chapterUrl>"; exit 1)
	@mkdir -p "$(SCRAPE_DIR)"
	@echo "Scraping $(URL) ..."
	@node scripts/scrapeChapter.mjs "$(URL)" > "$(SCRAPE_DIR)/$$(basename "$(URL)" .html).json"
	@echo "Wrote $(SCRAPE_DIR)/$$(basename "$(URL)" .html).json"

headings-songshi:
	@mkdir -p "$(SCRAPE_DIR)"
	@echo "Fetching Songshi headings/index ..."
	@node scripts/scrapeSongshiHeadings.mjs songshi > "$(SCRAPE_DIR)/songshi-headings.json"
	@echo "Wrote $(SCRAPE_DIR)/songshi-headings.json"

headings-jinshi:
	@mkdir -p "$(SCRAPE_DIR)"
	@echo "Fetching Jinshi headings/index ..."
	@node scripts/scrapeSongshiHeadings.mjs jinshi > "$(SCRAPE_DIR)/jinshi-headings.json"
	@echo "Wrote $(SCRAPE_DIR)/jinshi-headings.json"

sort-events:
	@echo "Sorting and normalizing data/events-1127-1142.jsonl (in-place) ..."
	@node scripts/sortEvents.mjs "data/events-1127-1142.jsonl" --in-place
	@echo "Done."


