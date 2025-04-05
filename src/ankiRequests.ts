import { logWithTag } from './auxilliary';
import { ProcessFunction } from './interfaces';
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

    async processAnkiDeck(options: ProcessFunction) {
        // we always log failures as notices, but leave sucesses up to the settings
        const { shouldCreate, logAsNotice } = options;  
        const deckName = this.plugin.settings.ankiDeckName;

        try {
            const existingDecks: string[] = await this.ankiRequest<string[]>('deckNames');

            if (!existingDecks.includes(deckName)) {
				if (!shouldCreate) {
					logWithTag(`Anki deck "${deckName}" could not be found. Please create manually, or allow automatic deck creation in settings.`);
					return;
				}

                // createDeck returns the new deck's ID on success, or null/error
                const createResult = await this.ankiRequest<number|null>('createDeck', { deck: deckName });

                if (createResult === null) { logWithTag('Attempted to create Anki deck, but failed.'); } else { logWithTag(`Deck "${deckName}" created successfully (ID: ${createResult}).`, logAsNotice); }

            } else { logWithTag(`Anki sync: Found existing anki deck "${deckName}"!`, logAsNotice); }

        } catch (error) {
            logWithTag(`Failed to ensure Anki deck "${deckName}" exists. Check Anki/AnkiConnect. Error: ${error.message || error}`);
            throw(error);
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
    async processAnkiModel(options: ProcessFunction) {
        // Always log negatives as notices, leave positives up to the argument
        const { shouldCreate, logAsNotice } = options;

        const modelName = this.plugin.settings.noteTypeName;
        const GuidField = this.plugin.settings.obsidianGuidProperty;
        const desiredFields = [
            GuidField, ...
            this.plugin.settings.propertyNames, ...
            this.plugin.settings.callouts
        ];

        // Basic validation of required settings
        if (!modelName || modelName.trim() === '') { throw new Error('Error: invalid note type name provided.'); }
        if (!GuidField || GuidField.trim() === '') { throw new Error('Error: Please provide a valid GUID field name.'); }

        try {
            // Check if the Note Type (Model) exists
            const modelNames = await this.ankiRequest<string[]>('modelNames');
            const modelExists = modelNames.includes(modelName);

            // Create mdel if it does not exist
            if (!modelExists) {
                if (!shouldCreate) {
                    logWithTag(`Anki Note Type "${modelName}" could not be found. Please create manually, or allow automatic model creation in settings.`);
                    return;
                }

                const newCardTemplates = [{
                        Name: `Default GUID field`,
                        Front: `{{${GuidField}}}`,
                        Back: ''
                    }];
                await this.ankiRequest<void>('createModel', {
                    modelName: modelName,
                    inOrderFields: desiredFields,
                    cardTemplates: newCardTemplates,
                    isCloze: false
                });
                logWithTag(`Model "${modelName}" created successfully.`, logAsNotice);
                return;
            }

            // If model exists, check if it needs modification
            else {
                const originalAnkiFields = await this.ankiRequest<string[]>('modelFieldNames', { modelName: modelName });

                // If everything is the same, log and return
                if (this.areFieldArraysEqual(originalAnkiFields, desiredFields)) {
                    logWithTag(`Anki sync: Anki Note Type "${modelName}" with correct fields found.`, logAsNotice);
                    return;
                }
                
                // Otherwise we need to process fields. First remove invalid fields, iterating backwards to stop range errors.
                const desiredSet = new Set(desiredFields);
                for (let i = originalAnkiFields.length - 1; i >= 0; i--) {
                    const fieldName = originalAnkiFields[i];
                    if (!desiredSet.has(fieldName)) { await this.ankiRequest<void>('modelFieldRemove', { modelName: modelName, fieldName: fieldName }); }
                }

                // Iterate through our desired fields, check if we need to add or reposition
                // Every time we process an item, we pop it from the tmpAnkiFields. This means if an item is not in the first location of the array, it is in the wrong location
                for (let i = 0; i < desiredFields.length; i++) {
                    const tmpAnkiFields = [...originalAnkiFields];
                    const desiredFieldName = desiredFields[i];
                    const currentFieldIndex = originalAnkiFields.indexOf(desiredFieldName);

                    // If field in right position, continue
                    if (currentFieldIndex === 1) { continue; }

                    // if field does not exist, create it
                    else if (currentFieldIndex == -1) {
                        await this.ankiRequest<void>('modelFieldAdd', {
                            modelName: modelName,
                            fieldName: desiredFieldName,
                            index: i
                        });
                        // Add to our temporary list to track state for repositioning
                        originalAnkiFields.splice(i, 0, desiredFieldName);
                    
                    // Otherwise the field is in the wrong position, so reposition it
                    await this.ankiRequest<void>('modelFieldReposition', {
                        modelName: modelName,
                        fieldName: desiredFieldName,
                        index: i
                    });
                    tmpAnkiFields.splice(currentFieldIndex, 1);  // remove field that we just processed
                    }
                }
                logWithTag(`Model "${modelName}" fields updated.`, logAsNotice);
                return;

            }

        } catch (error) {
            // Handle potential errors from ankiConnectRequest (network or API errors)
            let specificError = error.message || 'Unknown error';

            // Try to provide a more user-friendly message for common network errors
            if (specificError.includes('Failed to fetch') || specificError.includes('NetworkError') || specificError.includes('ECONNREFUSED')) {
                specificError = 'Failed to connect to AnkiConnect. Is Anki open and AnkiConnect installed?';
            }

            throw error;
        }
    }
}