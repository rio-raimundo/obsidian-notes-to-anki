// Interface for plugin settings
export interface AnkiSyncSettings {
    ankiConnectUrl: string;
    ankiDeckName: string;
    createDeckIfNotFound: boolean;
    noteTypeName: string;
    obsidianGuidProperty: string; // Name of the property in Obsidian frontmatter
    propertyNames: string[];
    callouts: string[];
    tagsToInclude: string[];
    tagsToExclude: string[];
}

export const DEFAULT_SETTINGS: AnkiSyncSettings = {
    ankiConnectUrl: 'http://127.0.0.1:8765',
    ankiDeckName: 'Obsidian articles',
    createDeckIfNotFound: true,
    noteTypeName: 'obsidian-articles', // Matches the Anki Note Type name
    obsidianGuidProperty: 'citation key', // Matches the Obsidian property name
    propertyNames: ['title', 'authors', 'journal', 'year'],
    callouts: ['summary'],
    tagsToInclude: [],
    tagsToExclude: []
}

export interface ProcessFunction {
    shouldCreate: boolean;
    logAsNotice: boolean;
}