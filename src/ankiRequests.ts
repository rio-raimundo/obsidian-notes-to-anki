import { logWithTag } from './auxilliary';
import AnkiSyncPlugin from './main';

export class AnkiRequests{
    plugin: AnkiSyncPlugin;
    get url() { return this.plugin.settings.ankiConnectUrl; }

    constructor(plugin: AnkiSyncPlugin) {
        this.plugin = plugin;
    }

    // Helper function to make AnkiConnect requests
    async ankiRequest<T>(action: string, params: object = {}): Promise<T> {
        const body = JSON.stringify({ action, version: 6, params });
        const response = await fetch(this.url, {
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
    async checkAnkiConnect(): Promise<void> {
        try {
            const version = await this.ankiRequest<number>('version');
            logWithTag(`AnkiConnect connected successfully (version ${version}).`);
        } catch (error) {
            logWithTag(`AnkiConnect failed to connect (${error}).`);
            throw(error);
        }
    }

    async findAnkiDeck(deckName: string, createIfNotFound: boolean) {
        try {
            const existingDecks: string[] = await this.ankiRequest<string[]>('deckNames');

            if (!existingDecks.includes(deckName)) {
				if (!createIfNotFound) {
					logWithTag(`Anki deck "${deckName}" could not be found. Either create it manually, change deck name, or change setting to allow automatic creation.`);
					return;
				}

                // createDeck returns the new deck's ID on success, or null/error
                const createResult = await this.ankiRequest<number|null>('createDeck', { deck: deckName });

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

    /**
     * Checks if two arrays of strings are identical (same elements in the same order).
     * @param {string[]} arr1 The first array.
     * @param {string[]} arr2 The second array.
     * @returns {boolean} True if the arrays are identical, false otherwise.
     */
    areFieldArraysEqual(arr1: string[], arr2: string[]): boolean {
        if (arr1.length !== arr2.length) { return false; }
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) { return false; }
        }
        return true;
    }

    /**
     * Ensures a specific Anki Note Type (Model) exists with the correct fields.
     * If it exists, it checks and updates the fields if necessary (preserving card templates).
     * If it doesn't exist, it creates it with the specified fields and a single card
     * template using the ankiGuidField for the front and a blank back.
     *
     * Assumes an `ankiConnectRequest(action, params, version)` function is available globally
     * or within the scope this function is defined in.
     *
     * @param {object} pluginSettings The Obsidian plugin settings object.
     * @param {string} pluginSettings.noteTypeName The desired name for the Anki Note Type.
     * @param {string[]} pluginSettings.fieldNames An array of field names in the desired order.
     * @param {string} pluginSettings.ankiGuidField The name of the field to use for the front of the default card template.
     * @returns {Promise<{success: boolean, action: 'created' | 'updated' | 'unchanged' | 'error', message: string}>}
     *          An object indicating the outcome.
     */
    async ensureAnkiNoteTypeModel() {
        const modelName = this.plugin.settings.noteTypeName;
        const GuidField = this.plugin.settings.obsidianGuidProperty;
        const fieldNames = [
            GuidField, ...
            this.plugin.settings.propertyNames, ...
            this.plugin.settings.callouts
        ];

        // Basic validation of required settings
        if (!modelName || typeof modelName !== 'string' || modelName.trim() === '') {
            throw new Error('Error: Note Type Name setting is missing or invalid.');
        }
        if (!Array.isArray(fieldNames) || fieldNames.length === 0 || !fieldNames.every(f => typeof f === 'string' && f.trim() !== '')) {
            throw new Error('Error: Field Names are missing, empty, or invalid in settings.');
        }
        if (!GuidField || typeof GuidField !== 'string' || GuidField.trim() === '') {
            throw new Error('Error: Anki GUID Field setting is missing or invalid.');
        }

        try {
            // Check if the Note Type (Model) exists
            const modelNames = await this.ankiRequest<string[]>('modelNames');
            const modelExists = modelNames.includes(modelName);

            if (modelExists) {
                // Model exists - Check if fields need modification
                const currentFields = await this.ankiRequest<string[]>('modelFieldNames', { modelName: modelName });

                // If everything is the same, log and return
                if (this.areFieldArraysEqual(currentFields, fieldNames)) { logWithTag(`Anki sync: Anki Note Type "${modelName}" with correct fields found.`, false); return; }
                
                // Remove fields not in desired list (iterate backwards to avoid index issues)
                const desiredFields = new Set(fieldNames);
                for (let i = currentFields.length - 1; i >= 0; i--) {
                    const fieldName = currentFields[i];
                    if (!desiredFields.has(fieldName)) {
                        await this.ankiRequest<void>('modelFieldRemove', { modelName: modelName, fieldName: fieldName });
                    }
                }

                // Add or reposition fields
                for (let i = 0; i < fieldNames.length; i++) {
                    const desiredFieldName = fieldNames[i];
                    const currentFieldIndex = currentFields.indexOf(desiredFieldName);
    
                    if (currentFieldIndex === -1) {
                        // Field needs to be added
                        await this.ankiRequest<void>('modelFieldAdd', {
                            modelName: modelName,
                            fieldName: desiredFieldName,
                            index: i // Add at the correct position
                        });
                        // Add to our temporary list to track state for repositioning
                        currentFields.splice(i, 0, desiredFieldName);
                    } else if (currentFieldIndex !== i) {
                        // Field exists but needs repositioning
                        await this.ankiRequest<void>('modelFieldReposition', {
                            modelName: modelName,
                            fieldName: desiredFieldName,
                            index: i
                        });
                        // Update our temporary list to reflect the move
                        const [movedField] = currentFields.splice(currentFieldIndex, 1);
                        currentFields.splice(i, 0, movedField);
                    }
                }
                logWithTag(`Model "${modelName}" fields updated.`);
                return;

            } else {
                // 2b. Model does not exist - Create it
                // Define the single card template as requested
                const newCardTemplates = [
                    {
                        // Name is omitted, Anki will provide default like "Card 1"
                        Front: `{{${GuidField}}}`, // Use the specified field for the front
                        Back: '' // Blank back side
                    }
                ];

                await this.ankiRequest<void>('createModel', {
                    modelName: modelName,
                    inOrderFields: fieldNames,
                    cardTemplates: newCardTemplates,
                    isCloze: false
                });
                logWithTag(`Model "${modelName}" created successfully.`);
                return;
            }

        } catch (error) {
            // Handle potential errors from ankiConnectRequest (network or API errors)
            const baseMessage = `Error ensuring Anki Model "${modelName}"`;
            let specificError = error.message || 'Unknown error';

            // Try to provide a more user-friendly message for common network errors
            if (specificError.includes('Failed to fetch') || specificError.includes('NetworkError') || specificError.includes('ECONNREFUSED')) {
                specificError = 'Failed to connect to AnkiConnect. Is Anki open and AnkiConnect installed?';
            }

            return { success: false, action: 'error', message: `${baseMessage}: ${specificError}` };
        }
    }
}