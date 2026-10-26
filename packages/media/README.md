# @reb/media

Reads the text inside media files (build plan, step 2), so extraction can treat a flyer or PDF like any other message.

| File              | What it does                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/describe.ts` | `describeMedia()`: picks the right reader by file type, or explains why the file is skipped                                     |
| `src/image.ts`    | `transcribeImage()`: sends an image to the vision model with the transcription prompt; `prepareImage()` scales huge photos down |
| `src/pdf.ts`      | `readPdf()`: text layer per page, vision only for pages without text                                                            |
| `src/sheet.ts`    | `readSpreadsheet()`: Excel price lists to text, one row per line                                                                |

| File type                                         | How it is read                                                                      | Model call?          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| Image (flyer, screenshot)                         | Vision model transcribes all text and tables (`packages/llm/prompts/transcribe.ts`) | Yes, 1               |
| PDF with text                                     | Text layer, page by page (pdf.js)                                                   | No                   |
| PDF page without text (scan, image-only brochure) | Rendered at 2× and transcribed                                                      | Yes, 1 per such page |
| Excel `.xlsx`                                     | Cells read directly, `cell                                                          | cell                 | cell` per row | No  |
| Voice note, video                                 | Not processed (decided with Hassan); a caption is still read                        | No                   |
| Word and other documents                          | Not supported yet; skipped with the reason                                          | No                   |

**Why it is designed this way**

- **Transcribe, then extract.** The vision model only copies text out of the image. Extraction then reads that text with the same prompt, no-invention check and number parsing as a text message, so images get the same safeguards.
- **Cheapest path first.** Most developer PDFs have a text layer: reading it is free, instant and exact. Only pages without text cost a model call. `PDF_MAX_PAGES` (10) caps long brochures; `PDF_MIN_TEXT_CHARS` (50) decides when a page counts as scanned.
- **Images are sent as they are.** Unlike text, images can't be scrubbed of phone numbers; Hassan approved sending them, since the groups are semi-public. Huge photos are scaled to 2,000 px (smaller, faster, still readable), and HEIC is converted to JPEG.
- **Images never fill the database.** The call log records "[NN KB image omitted]" instead of the image data.
