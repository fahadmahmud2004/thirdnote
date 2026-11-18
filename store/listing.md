# Chrome Web Store listing for ThirdNote

Copy each part below into the matching field of the Chrome Web Store Developer Dashboard.

## Store listing tab

**Name** (comes from the manifest)
ThirdNote: Capture Everything. Remember Anything.

**Summary** (comes from the manifest, max 132 characters)
Save highlights, screenshots and ideas from AI chats and any website. Organise them on a board and review as flashcards.

**Homepage URL**
https://fahadmahmud2004.github.io/thirdnote/ (developer site: https://fahadmahmud.com)

**Category**
Productivity (Education also fits)

**Language**
English

**Description**

```
ThirdNote turns what you read in AI chats and on the web into notes you can come back to. Capture everything. Remember anything.

Select any text, pick a colour, and it is saved into the collection you choose. Grab screenshots that never get lost in your gallery again. Lay everything out on a board with your own sticky notes and ideas. Later, read it all in one clean place or test yourself with flashcards.

HIGHLIGHT ANYWHERE
- Select text on any website and pick a colour, or press 1 to 4.
- Name each colour for the way you work, such as Key point, Important, Example or Idea.
- Add a short note or a question to any highlight.
- Your highlights reappear when you return to the page.

SAVE AI CHATS
- Save a whole AI chat conversation with one click.
- New messages are added automatically while you keep chatting.
- Or select just the part you need and save only that.
- Math, code and tables keep their formatting.

COLLECTIONS
- Group everything by subject, project or idea.
- Turn on Collecting and every save goes straight into one collection.
- Write your own notes with headings, lists, links, images and highlights.
- Edit or trim anything you saved.

SCREENSHOTS
- Capture any area of the screen with Alt+Shift+S.
- Add a note and it goes straight into the right collection.
- On video sites, the video timestamp is saved with the screenshot.

SAVE ANY PAGE
- One click (or Alt+Shift+P) saves the whole page as a clean, readable copy, without menus, ads or sidebars.
- Social feeds become one tidy card per post: who posted, the text, photos and a link back. Posts you scrolled past are kept too.
- Video and picture grids become neat cards with titles and thumbnails.
- Chats in messaging web apps become message bubbles with names, replies and times.
- Online documents, forms and spreadsheets are saved too; wide sheets turn into one card per row.
- Save the same page again later to keep both copies, or replace the old one.
- Drag any picture from a page onto a collection to keep it.

BOARD
- Every collection has its own canvas.
- Your screenshots, clips, notes and saved chats appear as cards.
- Move, resize and connect them with arrows.
- Add sticky notes, headings, text and images (paste or drag them in).
- Perfect for thumbnail ideas, research, mood boards and study maps.

REVIEW
- Read saved chats as clean notes with your highlights.
- See only what you marked, filtered by colour.
- Practise with flashcards: your question is the prompt, your highlight is the answer.
- Copy one block, one message or the whole page with formatting, ready to paste.
- Copy or download any saved picture.
- Export to Markdown or PDF.

YOUR LIBRARY
- A full-page home for everything you saved: collections, recent items and highlights.
- Search finds any word, in any order.
- Click any saved text to edit it, right where you read it.

PRIVATE BY DESIGN
- Everything is stored in your own browser. No account, no servers, no tracking.
- Download a backup any time.

Light and dark themes. English and Bangla.

Made by Fahad Mahmud (fahadmahmud.com).
```

**Graphic assets** (all in `store/images/`)
- Store icon 128x128: `icons/icon128.png`
- Screenshots 1280x800: `screenshot-1-highlight.png` to `screenshot-5-review.png`
- Small promo tile 440x280: `promo-small-440x280.png`
- Marquee promo tile 1400x560: `promo-marquee-1400x560.png`

## Privacy tab

**Single purpose**

```
ThirdNote lets users highlight and save text, whole pages, AI chat conversations, notes and screenshots from web pages into local collections, arrange them on a board, and review them later.
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
Adds "Save selection to ThirdNote", "Save this whole page to ThirdNote" and "Capture an area to ThirdNote" to the right-click menu.
```

scripting
```
Used only when the user presses Save page: reads the content of large embedded frames on that page (for example an online spreadsheet shown inside a frame) so it can be saved. Nothing runs in frames otherwise.
```

Host permission (<all_urls>)
```
Users study from many sites (AI chats, video sites, encyclopedias, news, online documents), so the highlight toolbar and Save page must work on any page. The content script reads only the text the user selects, or a page or chat the user explicitly chooses to save. The host permission is also required by chrome.tabs.captureVisibleTab for screenshots, and to keep copies of pictures in a saved page, both only when the user asks.
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
