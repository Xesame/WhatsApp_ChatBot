# Sample messages

Put sample messages here to test the system without a WhatsApp number. Nothing you put here is committed, except this note and `demo-export/`, a made-up example to try first.

- A WhatsApp **Export chat** file, with its attached files in the same folder: `samples/<name>/_chat.txt` (iPhone) or `samples/<name>/WhatsApp Chat with ....txt` (Android). Unzip the export first.
- Or a plain `.txt` file with one message per block, blocks separated by a line with only `---`. A line `file: flyer.jpg` attaches `flyer.jpg` from the same folder.

Import with:

```sh
docker compose exec worker node apps/worker/src/cli.ts import "samples/<name>/_chat.txt" --group "My sample group" --type broker
```
