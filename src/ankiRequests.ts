import { logWithTag } from './auxilliary';
import { Notice } from 'obsidian';
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
            console.log(`Checking if Anki deck "${deckName}" exists...`);
            const existingDecks: string[] = await this.ankiRequest<string[]>(this.url, 'deckNames');

            if (!existingDecks.includes(deckName)) {
				if (!createIfNotFound) {
					const text = `Anki deck "${deckName}" could not be found. Either create it manually, change deck name, or change setting to allow automatic creation. `
					new Notice(text);
					console.info(text);
					return;
				}

                new Notice(`Anki deck "${deckName}" not found. Creating deck automatically...`);
                console.log(`Attempting to create deck: ${deckName}`);

                // createDeck returns the new deck's ID on success, or null/error
                const createResult = await this.ankiRequest<number|null>(this.url, 'createDeck', { deck: deckName });

                if (createResult === null) {
                     // AnkiConnect might return null even on success in some edge cases or versions
                     console.warn(`AnkiConnect returned null for creating deck "${deckName}", but proceeding. Check Anki if deck was created.`);
                } else {
                    new Notice(`Successfully created Anki deck: "${deckName}"`);
                    console.log(`Deck "${deckName}" created successfully (ID: ${createResult}).`);
                }
            } else {
                console.log(`Anki sync: Found existing anki deck "${deckName}"!`);
            }
        } catch (error) {
            console.error(`Error checking or creating Anki deck "${deckName}":`, error);
            // Provide more specific feedback if possible
            if (error.message && error.message.includes("deck name conflicts with existing model")) {
                 new Notice(`Error: Deck name "${deckName}" conflicts with an existing Anki Note Type name. Please choose a different deck name.`);
            } else {
                 new Notice(`Failed to ensure Anki deck "${deckName}" exists. Check Anki/AnkiConnect. Error: ${error.message || error}`);
            }

            // Stop the sync process if deck handling fails critically
            return; // Exit the sync function
        }
    }
}