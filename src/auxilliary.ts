import { Notice } from "obsidian";

export function logWithTag(message: string, asNotice = true, asLog = true) {
	const tag = "Notes to anki";
    const outString = `${tag}: ${message}`
    
    if (asNotice) new Notice(outString);
	if (asLog) console.log(outString);
}