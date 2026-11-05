# Chrome Web Store listing for ThirdNote

Copy each part below into the matching field of the Chrome Web Store Developer Dashboard.

## Store listing tab

**Name** (comes from the manifest)
ThirdNote: AI Chat Notes & Highlighter

**Summary** (comes from the manifest, max 132 characters)
Highlight and save what you learn from AI chats and any website, then review it as flashcards.

**Homepage URL**
https://fahadmahmud2004.github.io/thirdnote/ (developer site: https://fahadmahmud.com)

**Category**
Productivity (Education also fits)

**Language**
English

**Description**

```
ThirdNote turns what you read in AI chats and on the web into notes you can come back to. Capture everything. Remember anything.

Select any text, pick a colour, and it is saved into the collection you choose. Later, read it all in one clean place or test yourself with flashcards.

HIGHLIGHT ANYWHERE
- Select text on any website and pick a colour, or press 1 to 4.
- Name each colour for the way you work, such as Key point, Important, Example or Idea.
- Add a short note or a question to any highlight.
- Your highlights reappear when you return to the page.

SAVE AI CHATS
- Save a whole conversation from popular AI chat sites such as ChatGPT, Claude and Gemini with one click.
- New messages are added automatically while you keep chatting.
- Or select just the part you need and save only that.
- Math, code and tables keep their formatting.

COLLECTIONS
- Group everything by subject, project or idea.
- Turn on Collecting and every save goes straight into one collection.
- Write your own notes, and edit or trim anything you saved.

SCREENSHOTS
- Capture any area of the screen with Alt+Shift+S.
- On YouTube, the video timestamp is saved with the screenshot.

REVIEW
- Read saved chats as clean notes with your highlights.
- See only what you marked, filtered by colour.
- Practise with flashcards: your question is the prompt, your highlight is the answer.
- Export to Markdown or PDF.

PRIVATE BY DESIGN
- Everything is stored in your own browser. No account, no servers, no tracking.
- Download a backup any time.

Light and dark themes. English and Bangla.

Made by Fahad Mahmud (fahadmahmud.com).
```

**Graphic assets** (all in `store/images/`)
- Store icon 128x128: `icons/icon128.png`
- Screenshots 1280x800: `screenshot-1-highlight.png` to `screenshot-5-capture.png`
- Small promo tile 440x280: `promo-small-440x280.png`
- Marquee promo tile 1400x560: `promo-marquee-1400x560.png`

## Privacy tab

**Single purpose**

```
ThirdNote lets users highlight and save text, AI chat conversations, notes and screenshots from web pages into local collections, and review them later.
```

**Permission justifications**

storage
```
Saves the user's highlights, saved chats, notes and settings in the browser.
```

unlimitedStorage
```
Saved chats and screenshots can exceed the default storage quota. All data stays on the user's device.
```

sidePanel
```
The extension's library, collection picker and note composer are shown in the side panel.
```

contextMenus
```
Adds "Save selection to ThirdNote" and "Capture an area to ThirdNote" to the right-click menu.
```

Host permission (<all_urls>)
```
Users study from many sites (AI chats, YouTube, Wikipedia, news, PDFs), so the highlight toolbar must work on any page the user selects text on. The content script only reads the text the user selects, or a chat the user explicitly chooses to save. The host permission is also required by chrome.tabs.captureVisibleTab for the screenshot feature, which runs only when the user asks for it.
```

**Remote code**
No, I am not using remote code.

**Data usage**
Leave every data type unchecked. ThirdNote stores everything locally and never transmits user data off the device, so nothing is "collected" in the Chrome Web Store sense.

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
The public address where you host `store/privacy-policy.html` https://fahadmahmud2004.github.io/thirdnote/privacy.html.

## Distribution tab

- Visibility: Public (or Unlisted to test with friends first)
- Regions: All regions
- Pricing: Free
