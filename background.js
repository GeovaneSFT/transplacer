const translationCache = new Map();

function getCacheKey(text, targetLang) {
    return `${text.trim().replace(/\s+/g, ' ')}|${targetLang}`;
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "translate",
        title: "Traduzir para",
        contexts: ["selection"]
    });

    const languages = [
        { id: "EN-US", title: "Inglês Americano" },
        { id: "EN-GB", title: "Inglês Britânico" },
        { id: "PT-BR", title: "Português" },
        { id: "ES", title: "Espanhol" },
        { id: "FR", title: "Francês" },
        { id: "DE", title: "Alemão" },
        { id: "JA", title: "Japonês" }
    ];

    languages.forEach(lang => {
        chrome.contextMenus.create({
            id: `translate_${lang.id}`,
            parentId: "translate",
            title: lang.title,
            contexts: ["selection"]
        });
    });

    chrome.contextMenus.create({
        id: "revert",
        title: "Reverter tradução",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId.startsWith('translate_')) {
        const targetLang = info.menuItemId.split('_')[1];
        chrome.tabs.sendMessage(tab.id, {
            action: "translate",
            targetLang: targetLang
        });
    } else if (info.menuItemId === "revert") {
        chrome.tabs.sendMessage(tab.id, { action: "revert" });
    }

});

chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) return;
        
        switch(command) {
            case "translate-selection":
                chrome.tabs.sendMessage(tabs[0].id, { action: "translate" });
                break;
            case "revert-translation":
                chrome.tabs.sendMessage(tabs[0].id, { action: "revert" });
                break;
        }
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translateText") {
        const cacheKey = getCacheKey(request.text, request.targetLang);
        
        if (translationCache.has(cacheKey)) {
            sendResponse({ 
                success: true, 
                translatedText: translationCache.get(cacheKey),
                fromCache: true 
            });
            return true;
        }

        chrome.storage.local.get(['userSettings'], ({ userSettings }) => {
            if (!userSettings?.apiKey) {
                sendResponse({ success: false, error: "Chave API não configurada" });
                return;
            }

            const postData = {
                text: [request.text],
                target_lang: request.targetLang || userSettings.targetLang || "EN-US",
                ...(userSettings.sourceLang !== 'auto' && { source_lang: userSettings.sourceLang })
            };

            const endpoint = userSettings.apiType === 'pro'
                ? 'https://api.deepl.com/v2/translate'
                : 'https://api-free.deepl.com/v2/translate';

            fetch(endpoint, {
                method: "POST",
                headers: {
                    "Authorization": `DeepL-Auth-Key ${userSettings.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(postData)
            })
                .then(response => response.ok ? response.json() : Promise.reject(response))
                .then(data => {
                    translationCache.set(cacheKey, data.translations[0].text);
                    sendResponse({ success: true, translatedText: data.translations[0].text });
                })
                .catch(error => {
                    error.json().then(errData => {
                        sendResponse({ success: false, error: errData.message || "Erro na API" });
                    });
                });
        });

        return true;
    }
});