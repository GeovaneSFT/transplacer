const originalContentCache = new WeakMap();

const translationCache = new Map();

// Histórico de traduções para permitir múltiplos "ctrl+z"
const translationHistory = [];
const MAX_HISTORY_SIZE = 50; // Limite máximo do histórico


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
    return text.trim();
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

function showHistoryCount() {
    if (translationHistory.length > 0) {
        showMessage(`Histórico: ${translationHistory.length} tradução(ões) podem ser desfeitas`);
    }
}
let lastTranslatedContainer = null;

let lastTranslatedRange = null;

function translateSelection(targetLang = null) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        showMessage("Selecione um texto para traduzir.", true);
        return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString();

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
                {
                    acceptNode: function (node) {
                        if (!node.textContent.trim()) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                },
                false
            );

            let textFound = false;
            let node;

            const originalLines = selectedText.split('\n');
            const translatedLines = response.translatedText.split('\n');

            let lineIndex = 0;
            while ((node = walker.nextNode()) && lineIndex < originalLines.length) {
                const originalLine = originalLines[lineIndex];
                const translatedLine = translatedLines[lineIndex] || '';

                const originalTrimmed = originalLine.trim();
                if (!originalTrimmed) {
                    lineIndex++;
                    continue;
                }

                const nodeText = node.textContent;
                if (nodeText.includes(originalTrimmed)) {
                    const yamlLike = originalLine.match(/^(\s*)([^\s].*?):(.*)$/);

                    if (yamlLike) {
                        const [, indent, key] = yamlLike;
                        node.textContent = nodeText.replace(
                            originalTrimmed,
                            `${indent}${key}: ${translatedLine.trim()}`
                        );
                    } else {
                        const indentation = originalLine.match(/^\s*/)?.[0] || '';
                        node.textContent = nodeText.replace(
                            originalTrimmed,
                            indentation + translatedLine.trim()
                        );
                    }

                    lineIndex++;
                    textFound = true;
                }
            }

            if (!textFound) {
                const lines = selectedText.split('\n');
                const firstIndentation = lines[0].match(/^\s*/)?.[0] || '';
                const translated = response.translatedText
                    .split('\n')
                    .map(line => firstIndentation + line)
                    .join('\n');

                const translatedNode = document.createElement('span');
                translatedNode.textContent = translated;
                translatedNode.setAttribute('data-original', selectedText);
                translatedNode.setAttribute('data-target-lang', targetLang);
                translatedNode.setAttribute('data-translation-id', Date.now().toString());
                
                range.deleteContents();
                range.insertNode(translatedNode);
                
                // Adiciona ao histórico de traduções
                translationHistory.push({
                    id: translatedNode.getAttribute('data-translation-id'),
                    element: translatedNode,
                    originalText: selectedText,
                    translatedText: translated,
                    targetLang: targetLang
                });
                
                // Limita o tamanho do histórico
                if (translationHistory.length > MAX_HISTORY_SIZE) {
                    translationHistory.shift();
                }
                
                // Mostra contador de histórico
                showHistoryCount();
            }

            lastTranslatedRange = range.cloneRange();
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
    // Verifica se há entradas no histórico
    if (translationHistory.length > 0) {
        // Obtém a entrada mais recente do histórico (topo da pilha)
        const lastTranslation = translationHistory.pop();
        
        // Tenta encontrar o elemento pelo ID
        const element = document.querySelector(`[data-translation-id="${lastTranslation.id}"]`);
        
        if (element) {
            revertTranslatedElement(element, lastTranslation.originalText);
            showMessage(`Tradução desfeita! (${translationHistory.length} restante(s) no histórico)`);
            return;
        } else {
            // Se o elemento não for encontrado pelo ID, tenta usar a seleção atual
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const selectedNode = range.commonAncestorContainer;
                
                // Tenta encontrar o elemento traduzido a partir da seleção atual
                const result = findTranslatedElementFromNode(selectedNode);
                if (result.found) {
                    revertTranslatedElement(result.element, result.originalText);
                    selection.removeAllRanges();
                    showMessage(`Tradução desfeita! (${translationHistory.length} restante(s) no histórico)`);
                    return;
                }
            }
            
            // Se não houver seleção atual, tenta usar a última tradução
            if (lastTranslatedRange) {
                const node = lastTranslatedRange.commonAncestorContainer;
                const result = findTranslatedElementFromNode(node);
                
                if (result.found) {
                    revertTranslatedElement(result.element, result.originalText);
                    lastTranslatedRange = null;
                    showMessage(`Tradução desfeita! (${translationHistory.length} restante(s) no histórico)`);
                    return;
                }
            }
        }
    } else {
        // Comportamento padrão quando não há histórico
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const selectedNode = range.commonAncestorContainer;
            
            const result = findTranslatedElementFromNode(selectedNode);
            if (result.found) {
                revertTranslatedElement(result.element, result.originalText);
                selection.removeAllRanges();
                showMessage("Texto restaurado ao original!");
                return;
            }
        }
        
        if (lastTranslatedRange) {
            const node = lastTranslatedRange.commonAncestorContainer;
            const result = findTranslatedElementFromNode(node);
            
            if (result.found) {
                revertTranslatedElement(result.element, result.originalText);
                lastTranslatedRange = null;
                showMessage("Texto restaurado ao original!");
                return;
            }
        }
    }
    
    showMessage("Não foi possível encontrar o texto original. Selecione o texto traduzido.", true);
}

function findTranslatedElementFromNode(node) {
    // Se o nó for um nó de texto, pegamos o elemento pai
    let element = node;
    if (element.nodeType === Node.TEXT_NODE) {
        element = element.parentElement;
    }
    
    // Procura pelo elemento traduzido mais próximo
    while (element) {
        // Verifica se o elemento atual tem o atributo data-original
        if (element.hasAttribute && element.hasAttribute('data-original')) {
            return {
                found: true,
                element: element,
                originalText: element.getAttribute('data-original')
            };
        }
        
        // Verifica se algum elemento filho tem o atributo data-original
        const translatedChild = element.querySelector('[data-original]');
        if (translatedChild) {
            return {
                found: true,
                element: translatedChild,
                originalText: translatedChild.getAttribute('data-original')
            };
        }
        
        // Sobe para o elemento pai
        element = element.parentElement;
    }
    
    return { found: false };
}

function revertTranslatedElement(element, originalText) {
    // Cria um nó de texto com o conteúdo original
    const textNode = document.createTextNode(originalText);
    
    // Substitui o elemento traduzido pelo texto original
    if (element.parentNode) {
        element.parentNode.replaceChild(textNode, element);
    }
    
    // Atualiza o contador de histórico após reverter
    setTimeout(() => {
        showHistoryCount();
    }, 3500);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
        translateSelection(request.targetLang);
    } else if (request.action === "revert") {
        revertSelection();
    }
});
