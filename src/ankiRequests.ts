import { logWithTag } from './auxilliary';
import AnkiSyncPlugin from './main';

export class AnkiRequests{
    plugin: AnkiSyncPlugin;
    get url() { return this.plugin.settings.ankiConnectUrl; }

    constructor(plugin: AnkiSyncPlugin) {
        this.plugin = plugin;
    }

    // Helper function to make AnkiConnect requests
    async ankiRequest<T>(url: string, action: string, params: object = {}): Promise<T> {
        const body = JSON.stringify({ action, version: 6, params });
        const response = await fetch(url, {
            method: 'POST',
            body: body,
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
    
        const data = await response.json();
        if (data.error) { throw new Error(`AnkiConnect Error: ${data.error}`); }
    
        return data.result;
    }
    
    // Function to check the version of Anki, to see if it is open
    async checkAnkiConnect(url: string): Promise<void> {
        try {
            const version = await this.ankiRequest<number>(url, 'version');
            logWithTag(`AnkiConnect connected successfully (version ${version}).`);
        } catch (error) {
            logWithTag(`AnkiConnect failed to connect (${error}).`);
        }
    }

    async findAnkiDeck(deckName: string, createIfNotFound: boolean) {
        try {
            const existingDecks: string[] = await this.ankiRequest<string[]>(this.url, 'deckNames');

            if (!existingDecks.includes(deckName)) {
				if (!createIfNotFound) {
					logWithTag(`Anki deck "${deckName}" could not be found. Either create it manually, change deck name, or change setting to allow automatic creation.`);
					return;
				}

                // createDeck returns the new deck's ID on success, or null/error
                const createResult = await this.ankiRequest<number|null>(this.url, 'createDeck', { deck: deckName });

                if (createResult === null) { logWithTag('Attempted to create Anki deck, but failed.'); } else { logWithTag(`Deck "${deckName}" created successfully (ID: ${createResult}).`); }

            } else {
                logWithTag(`Anki sync: Found existing anki deck "${deckName}"!`, false);
            }
        } catch (error) {
            if (error.message && error.message.includes("deck name conflicts with existing model")) {
                 logWithTag(`Error: Deck name "${deckName}" conflicts with an existing Anki Note Type name. Please choose a different deck name.`);
            } else {
                logWithTag(`Failed to ensure Anki deck "${deckName}" exists. Check Anki/AnkiConnect. Error: ${error.message || error}`);
            }
            return; // Exit the sync function
        }
    }
}