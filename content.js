const originalContentCache = new WeakMap();

const translationCache = new Map();


function getTranslationKey(text, targetLang) {
    return `${text}|${targetLang}`;
}

function findOriginalText(element) {
    let current = element;
    let originalText = null;
    let translations = [];
    let processedNodes = new Set();

    while (current && current.hasAttribute && current.hasAttribute("data-original")) {
        if (processedNodes.has(current)) {
            break;
        }
        processedNodes.add(current);

        translations.unshift({
            text: current.textContent,
            lang: current.getAttribute("data-target-lang"),
            original: current.getAttribute("data-original")
        });
        originalText = current.getAttribute("data-original");

        current = current.parentElement?.closest('[data-original]') || null;
    }

    return { originalText, translations };
}

function normalizeText(text) {
    return text.trim().replace(/\s+/g, ' ');
}

function isSameLanguageFamily(lang1, lang2) {
    if (!lang1 || !lang2) return false;
    return lang1.toUpperCase() === lang2.split('-')[0].toUpperCase();
}


function showMessage(message, isError = false) {
    const msgDiv = document.createElement('div');
    msgDiv.style.position = 'fixed';
    msgDiv.style.top = '20px';
    msgDiv.style.right = '20px';
    msgDiv.style.padding = '15px';
    msgDiv.style.background = isError ? '#ff4444' : '#00C851';
    msgDiv.style.color = 'white';
    msgDiv.style.borderRadius = '5px';
    msgDiv.style.zIndex = '10000';
    msgDiv.textContent = message;

    document.body.appendChild(msgDiv);
    setTimeout(() => msgDiv.remove(), 3000);
}

function translateSelection(targetLang = null) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        showMessage("Selecione um texto para traduzir.", true);
        return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (selectedText.length === 0) {
        showMessage("Selecione um texto válido.", true);
        return;
    }

    const originalContent = originalContentCache.get(range.commonAncestorContainer);
    const textToTranslate = normalizeText(originalContent?.text || selectedText);

    chrome.storage.local.get(['userSettings'], ({ userSettings }) => {
        const sourceLang = userSettings?.sourceLang || 'PT';

        if (isSameLanguageFamily(sourceLang, targetLang)) {
            if (originalContent) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(originalContent.node.cloneNode(true));
                selection.removeAllRanges();
                showMessage("Texto restaurado ao original!");
                return;
            }
            showMessage("Não é possível traduzir para o mesmo idioma do texto original.", true);
            return;
        }
    });

    if (!originalContentCache.has(range.commonAncestorContainer)) {
        originalContentCache.set(range.commonAncestorContainer, {
            text: selectedText,
            node: range.cloneContents()
        });
    }

    chrome.runtime.sendMessage({
        action: "translateText",
        text: textToTranslate,
        targetLang: targetLang
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Erro de runtime:", chrome.runtime.lastError);
            return;
        }

        if (response?.success) {
            const walker = document.createTreeWalker(
                range.commonAncestorContainer,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.includes(selectedText)) {
                    node.textContent = node.textContent.replace(selectedText, response.translatedText);
                    break;
                }
            }

            selection.removeAllRanges();

            if (response.fromCache) {
                showMessage("Tradução recuperada do cache!");
            }
        } else {
            showMessage(`Erro na tradução: ${response?.error || 'Erro desconhecido'}`, true);
        }
    });
}

function revertSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        alert("Selecione o texto traduzido para reverter.");
        return;
    }

    const container = selection.getRangeAt(0).commonAncestorContainer;
    const originalContent = originalContentCache.get(container);

    if (originalContent) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(originalContent.node.cloneNode(true));
        selection.removeAllRanges();
        originalContentCache.delete(container);
    } else {
        alert("O texto selecionado não foi traduzido ou não pode ser revertido.");
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
        translateSelection(request.targetLang);
    } else if (request.action === "revert") {
        revertSelection();
    }
});
