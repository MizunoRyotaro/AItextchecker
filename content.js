// AI文章チェッカー - メインコンテンツスクリプト
class AITextChecker {
  constructor() {
    this.isEnabled = true;
    this.minTextLength = 10; // 最小チェック文字数
    this.selectedText = '';
    this.lastCheckResult = null;
    this.initAttempts = 0;
    this.maxInitAttempts = 3;
    
    this.init();
  }

  async init() {
    this.initAttempts++;
    console.log(`AI文章チェッカー初期化開始 (試行 ${this.initAttempts}/${this.maxInitAttempts})`);
    
    try {
      // 設定を読み込み
      const settings = await this.loadSettings();
      this.isEnabled = settings.enabled !== false;
      this.minTextLength = settings.minLength || 10;
      
      if (this.isEnabled) {
        this.setupTextSelection();
        this.setupMessageListener();
        this.injectStyles();
        console.log('AI文章チェッカー初期化完了');
      }
    } catch (error) {
      console.error('初期化エラー:', error);
      
      // ポップアップウィンドウの場合は再試行
      if (this.initAttempts < this.maxInitAttempts && 
          (window.opener || window.parent !== window)) {
        console.log('ポップアップウィンドウと思われるため再試行します...');
        setTimeout(() => {
          this.init();
        }, 1000);
      }
    }
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['enabled', 'apiKey', 'minLength'], (result) => {
        resolve(result);
      });
    });
  }

  setupTextSelection() {
    // テキスト選択の監視
    let selectionTimeout = null;
    
    const handleSelection = () => {
      // 少し遅延させて選択が確定してから処理
      clearTimeout(selectionTimeout);
      selectionTimeout = setTimeout(() => {
        this.handleTextSelection();
      }, 100);
    };

    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);

    document.addEventListener('keyup', (event) => {
      // Shift+矢印キーでの選択なども対応
      if (event.shiftKey || event.key === 'ArrowLeft' || event.key === 'ArrowRight' || 
          event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        handleSelection();
      }
    });

    // コンテキストメニュー表示時の選択保持
    document.addEventListener('contextmenu', (event) => {
      const currentSelection = window.getSelection().toString().trim();
      if (currentSelection.length >= this.minTextLength) {
        console.log('Context menu triggered with valid selection:', currentSelection.substring(0, 50) + '...');
        this.selectedText = currentSelection;
        
        // 選択範囲も保存
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          this.selectionRange = selection.getRangeAt(0);
        }
      }
    });

    // フォーカス変更時の選択維持
    window.addEventListener('blur', () => {
      if (this.selectedText) {
        console.log('Window blur, preserving selection:', this.selectedText.substring(0, 30) + '...');
      }
    });
  }

  setupMessageListener() {
    // バックグラウンドスクリプトからのメッセージを受信
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'checkSelectedText') {
        // バックグラウンドから選択テキストが渡された場合はそれを使用
        if (request.selectedText) {
          console.log('Received selected text from background:', request.selectedText);
          this.selectedText = request.selectedText;
        } else {
          console.log('No text provided, checking current selection...');
          this.handleTextSelection();
        }
        
        this.checkSelectedText().then(result => {
          sendResponse(result);
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        return true; // 非同期レスポンスを有効化
      }
      
      if (request.action === 'ping') {
        // コンテンツスクリプトが生きているかのチェック
        sendResponse({ success: true, status: 'ready' });
        return true;
      }
      
      if (request.type === 'SETTINGS_UPDATED') {
        this.init(); // 設定更新時に再初期化
      }
    });
  }

  handleTextSelection() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    console.log('Text selection detected:', selectedText, 'Length:', selectedText.length);
    
    if (selectedText.length >= this.minTextLength) {
      this.selectedText = selectedText;
      // 選択範囲の情報も保存（結果表示位置の特定用）
      if (selection.rangeCount > 0) {
        this.selectionRange = selection.getRangeAt(0);
      }
      console.log('Valid text selection stored:', this.selectedText.substring(0, 50) + '...');
    } else {
      this.selectedText = '';
      this.selectionRange = null;
      if (selectedText.length > 0) {
        console.log('Text too short, cleared selection');
      }
    }
    
    return this.selectedText;
  }

  async checkSelectedText() {
    // 選択テキストの最終確認
    if (!this.selectedText) {
      this.handleTextSelection(); // 再度選択を試行
    }
    
    console.log('Checking text:', this.selectedText, 'Length:', this.selectedText?.length || 0);
    
    if (!this.selectedText || this.selectedText.length < this.minTextLength) {
      const errorMsg = this.selectedText
        ? `選択されたテキストが短すぎます（${this.selectedText.length}文字）。${this.minTextLength}文字以上のテキストを選択してください。`
        : `${this.minTextLength}文字以上のテキストを選択してください`;
      throw new Error(errorMsg);
    }

    try {
      // チェック中のインジケーターを表示
      this.showCheckingIndicator();

      const result = await this.callGeminiAPI(this.selectedText, this.detectContext());
      
      // 統計を更新
      this.updateStats(result);
      
      // 結果を表示
      this.showCheckResult(result);
      
      this.lastCheckResult = result;
      return { success: true, result };

    } catch (error) {
      console.error('AI Check Error:', error);
      this.showErrorIndicator(error.message);
      throw error;
    }
  }

  async callGeminiAPI(text, context) {
    const settings = await this.loadSettings();
    
    if (!settings.apiKey) {
      throw new Error('Gemini API キーが設定されていません。拡張機能の設定で設定してください。');
    }

    const prompt = this.buildPrompt(text, context);
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${settings.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000
        }
      })
    });

    if (!response.ok) {
      if (response.status === 400) {
        throw new Error('APIキーが無効です。設定を確認してください。');
      } else if (response.status === 429) {
        throw new Error('API利用制限に達しました。しばらく待ってから再試行してください。');
      } else {
        throw new Error(`API Error: ${response.status}`);
      }
    }

    const data = await response.json();
    return this.parseGeminiResponse(data);
  }

  buildPrompt(text, context) {
    const contextPrompts = {
      email: 'これはメールの文章です。',
      chat: 'これはチャットメッセージです。',
      form: 'これはフォーム入力の文章です。',
      default: 'これはWeb上の文章です。'
    };

    return `${contextPrompts[context] || contextPrompts.default}
以下の文章をチェックして、誤字脱字があれば修正してください。

【重要】必ず以下の条件を守ってください：
1. 誤字脱字の修正のみを行う（敬語、文体、表現の変更は行わない）
2. 修正が必要な場合は、修正版の全文を提供する
3. 修正箇所を明確に示す

文章：
"${text}"

回答は以下のJSON形式でお願いします：
{
  "hasIssues": boolean,
  "correctedText": "修正版の全文（修正がない場合は元の文章）",
  "issues": [
    {
      "type": "誤字脱字",
      "severity": "低" | "中" | "高",
      "original": "誤字脱字のある箇所",
      "corrected": "修正後の箇所",
      "explanation": "修正理由"
    }
  ],
  "overallComment": "修正内容の簡潔な説明"
}`;
  }

  parseGeminiResponse(data) {
    try {
      const text = data.candidates[0].content.parts[0].text;
      // JSONを抽出（マークダウンのコードブロックも考慮）
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/({[\s\S]*})/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        // 修正版テキストがない場合は元のテキストを設定
        if (!parsed.correctedText) {
          parsed.correctedText = this.selectedText;
        }
        return parsed;
      } else {
        // JSONが見つからない場合は簡易パース
        return {
          hasIssues: false,
          correctedText: this.selectedText,
          issues: [],
          overallComment: 'チェック結果の解析に失敗しました'
        };
      }
    } catch (error) {
      console.error('Response parsing error:', error);
      return {
        hasIssues: false,
        correctedText: this.selectedText,
        issues: [],
        overallComment: 'チェック結果の解析に失敗しました'
      };
    }
  }

  detectContext() {
    const url = window.location.href;
    
    if (url.includes('mail') || url.includes('outlook') || url.includes('gmail')) {
      return 'email';
    } else if (url.includes('teams') || url.includes('slack') || url.includes('discord') || url.includes('chat')) {
      return 'chat';
    } else if (document.querySelector('form')) {
      return 'form';
    }
    
    return 'default';
  }

  async updateStats(result) {
    try {
      const issuesFound = result.hasIssues ? result.issues.length : 0;
      await chrome.runtime.sendMessage({
        type: 'UPDATE_STATS',
        data: {
          type: 'check_completed',
          issuesFound: issuesFound
        }
      });
    } catch (error) {
      console.error('Stats update error:', error);
    }
  }

  showCheckingIndicator() {
    this.removeExistingIndicators();
    
    const indicator = document.createElement('div');
    indicator.className = 'ai-checker-indicator checking';
    indicator.innerHTML = '🔄 AIチェック中...';
    this.positionIndicator(indicator);
  }

  showCheckResult(result) {
    this.removeExistingIndicators();
    
    const indicator = document.createElement('div');
    indicator.className = `ai-checker-indicator ${result.hasIssues ? 'warning' : 'success'}`;
    
    if (result.hasIssues) {
      const issueCount = result.issues.length;
      indicator.innerHTML = `⚠️ ${issueCount}件の誤字脱字を発見`;
      indicator.style.cursor = 'pointer';
      indicator.addEventListener('click', () => {
        console.log('Indicator clicked, showing detailed results');
        this.showDetailedResults(result);
      });
    } else {
      indicator.innerHTML = '✅ 誤字脱字なし';
    }
    
    this.positionIndicator(indicator);
    
    // 5秒後に自動で非表示
    setTimeout(() => {
      this.removeExistingIndicators();
    }, 5000);
    
    console.log('Check result indicator shown');
  }

  showErrorIndicator(message) {
    this.removeExistingIndicators();
    
    const indicator = document.createElement('div');
    indicator.className = 'ai-checker-indicator error';
    indicator.innerHTML = `❌ ${message}`;
    indicator.style.cursor = 'pointer';
    indicator.addEventListener('click', () => {
      indicator.remove();
    });
    
    this.positionIndicator(indicator);
    
    // 10秒後に自動で非表示
    setTimeout(() => {
      this.removeExistingIndicators();
    }, 10000);
  }

  removeExistingIndicators() {
    const existingIndicators = document.querySelectorAll('.ai-checker-indicator');
    existingIndicators.forEach(indicator => indicator.remove());
  }

  positionIndicator(indicator) {
    const isPopupWindow = window.opener || window.parent !== window || window.location !== window.parent.location;
    const baseZIndex = isPopupWindow ? 999999 : 10000;
    
    console.log('Positioning indicator, window type:', isPopupWindow ? 'popup' : 'normal');
    
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      indicator.style.position = 'fixed';
      indicator.style.left = Math.max(10, rect.left + rect.width / 2 - 75) + 'px';
      indicator.style.top = Math.max(10, rect.top - 40) + 'px';
      indicator.style.zIndex = baseZIndex.toString();
      
      console.log('Indicator positioned at:', indicator.style.left, indicator.style.top);
    } else {
      // フォールバック：画面中央に表示
      indicator.style.position = 'fixed';
      indicator.style.left = '50%';
      indicator.style.top = '20px';
      indicator.style.transform = 'translateX(-50%)';
      indicator.style.zIndex = baseZIndex.toString();
      
      console.log('Indicator positioned at center');
    }
    
    // ポップアップウィンドウの場合は追加の調整
    if (isPopupWindow) {
      indicator.style.backgroundColor = 'rgba(102, 126, 234, 0.95)';
      indicator.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
      indicator.style.border = '2px solid rgba(255, 255, 255, 0.3)';
    }
    
    document.body.appendChild(indicator);
    console.log('Indicator appended to body');
    
    // インジケーターが表示されているかチェック
    setTimeout(() => {
      const indicatorRect = indicator.getBoundingClientRect();
      console.log('Indicator position and size:', indicatorRect);
    }, 50);
  }

  showDetailedResults(result) {
    console.log('Showing detailed results:', result);
    
    // 既存のモーダルを削除
    const existingModals = document.querySelectorAll('.ai-checker-modal');
    existingModals.forEach(modal => modal.remove());
    
    // ポップアップウィンドウかどうかを判定
    const isPopupWindow = window.opener || window.parent !== window || window.location !== window.parent.location;
    const baseZIndex = isPopupWindow ? 999999 : 10001;
    
    console.log('Window type detected:', isPopupWindow ? 'popup' : 'normal', 'Base z-index:', baseZIndex);

    // 詳細結果のポップアップを表示
    const modal = document.createElement('div');
    modal.className = 'ai-checker-modal';
    modal.style.zIndex = baseZIndex.toString();
    modal.innerHTML = `
      <div class="ai-checker-modal-content" style="z-index: ${baseZIndex + 1};">
        <div class="ai-checker-modal-header">
          <h3>🔍 誤字脱字チェック結果</h3>
          <button class="ai-checker-close">&times;</button>
        </div>
        <div class="ai-checker-modal-body">
          <div class="original-text">
            <h4>📝 元のテキスト:</h4>
            <div class="text-preview original">${this.escapeHtml(this.selectedText)}</div>
          </div>
          
          ${result.hasIssues ? `
          <div class="corrected-text">
            <h4>✅ 修正版テキスト:</h4>
            <div class="text-preview corrected">${this.escapeHtml(result.correctedText)}</div>
            <div class="copy-buttons">
              <button class="copy-button" data-text="${this.escapeHtml(result.correctedText)}">
                📋 修正版をコピー
              </button>
              <button class="replace-button" data-text="${this.escapeHtml(result.correctedText)}">
                🔄 元のテキストを修正版に置換
              </button>
            </div>
          </div>
          ` : `
          <div class="no-issues-message">
            <p>✅ 誤字脱字は見つかりませんでした。</p>
          </div>
          `}
          
          ${result.overallComment ? `<div class="overall-comment">
            <h4>📋 修正内容:</h4>
            <p>${result.overallComment}</p>
          </div>` : ''}
          
          <div class="ai-checker-issues">
            <h4>🔍 詳細な修正箇所:</h4>
            ${result.issues.length > 0 ? result.issues.map((issue, index) => `
              <div class="ai-checker-issue severity-${issue.severity}">
                <h5><span class="issue-number">${index + 1}.</span> <span class="issue-type">${issue.type}</span></h5>
                <p><strong>誤字:</strong> <span class="highlight-error">"${issue.original}"</span></p>
                <p><strong>正しい表記:</strong> <span class="highlight-correct">"${issue.corrected}"</span></p>
                <p><strong>理由:</strong> ${issue.explanation}</p>
              </div>
            `).join('') : '<p class="no-issues">誤字脱字は発見されませんでした。</p>'}
          </div>
        </div>
      </div>
    `;
    
    // ポップアップウィンドウの場合は追加のスタイル調整
    if (isPopupWindow) {
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      console.log('Applied popup window styles');
    }
    
    document.body.appendChild(modal);
    console.log('Modal appended to body');
    
    // モーダルが実際に表示されているかチェック
    setTimeout(() => {
      const modalRect = modal.getBoundingClientRect();
      console.log('Modal position and size:', modalRect);
      console.log('Modal computed style:', window.getComputedStyle(modal));
    }, 100);

    // コピーボタンの処理
    const copyButtons = modal.querySelectorAll('.copy-button');
    copyButtons.forEach(button => {
      button.addEventListener('click', async () => {
        const text = button.dataset.text;
        await this.copyToClipboard(text);
        button.innerHTML = '✅ コピー完了!';
        button.style.backgroundColor = '#10b981';
        setTimeout(() => {
          button.innerHTML = '📋 修正版をコピー';
          button.style.backgroundColor = '';
        }, 2000);
      });
    });

    // 置換ボタンの処理
    const replaceButtons = modal.querySelectorAll('.replace-button');
    replaceButtons.forEach(button => {
      button.addEventListener('click', () => {
        const correctedText = button.dataset.text;
        this.replaceSelectedText(correctedText);
        button.innerHTML = '✅ 置換完了!';
        button.style.backgroundColor = '#10b981';
        setTimeout(() => {
          modal.remove();
        }, 1000);
      });
    });
    
    // 閉じるボタンの処理
    modal.querySelector('.ai-checker-close').addEventListener('click', () => {
      console.log('Close button clicked');
      modal.remove();
    });
    
    // モーダル外クリックで閉じる
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        console.log('Modal background clicked');
        modal.remove();
      }
    });
    
    // ESCキーで閉じる
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        console.log('Escape key pressed');
        modal.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
    
    console.log('Modal event listeners attached');
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      console.log('テキストをクリップボードにコピーしました');
    } catch (error) {
      console.error('クリップボードへのコピーに失敗:', error);
      // フォールバック：テキストエリアを使用
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  }

  replaceSelectedText(newText) {
    try {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // 選択範囲を削除して新しいテキストを挿入
        range.deleteContents();
        
        // テキストノードを作成して挿入
        const textNode = document.createTextNode(newText);
        range.insertNode(textNode);
        
        // 挿入したテキストを選択状態にする
        range.selectNodeContents(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        console.log('テキストの置換が完了しました');
      }
    } catch (error) {
      console.error('テキスト置換に失敗:', error);
      // エラー時はクリップボードにコピー
      this.copyToClipboard(newText);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  injectStyles() {
    console.log('Injecting styles...');
    
    if (!document.getElementById('ai-checker-styles')) {
      const styleSheet = document.createElement('link');
      styleSheet.id = 'ai-checker-styles';
      styleSheet.rel = 'stylesheet';
      styleSheet.href = chrome.runtime.getURL('styles.css');
      
      // ポップアップウィンドウの場合は読み込み確認
      const isPopupWindow = window.opener || window.parent !== window;
      if (isPopupWindow) {
        styleSheet.onload = () => {
          console.log('CSS loaded successfully in popup window');
        };
        styleSheet.onerror = () => {
          console.error('CSS loading failed in popup window, trying inline styles');
          this.injectInlineStyles();
        };
      }
      
      document.head.appendChild(styleSheet);
      console.log('CSS link element added to head');
      
      // 少し待ってからCSSが適用されているかチェック
      setTimeout(() => {
        this.verifyCSSLoaded();
      }, 200);
    } else {
      console.log('CSS already injected');
    }
  }

  verifyCSSLoaded() {
    // テスト要素を作成してCSSが適用されているかチェック
    const testElement = document.createElement('div');
    testElement.className = 'ai-checker-indicator';
    testElement.style.position = 'absolute';
    testElement.style.top = '-9999px';
    testElement.style.visibility = 'hidden';
    document.body.appendChild(testElement);
    
    const computedStyle = window.getComputedStyle(testElement);
    const hasStyles = computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                     computedStyle.backgroundColor !== 'transparent';
    
    document.body.removeChild(testElement);
    
    if (!hasStyles) {
      console.warn('CSS not properly loaded, injecting inline styles');
      this.injectInlineStyles();
    } else {
      console.log('CSS verification successful');
    }
  }

  injectInlineStyles() {
    console.log('Injecting inline styles as fallback');
    
    if (document.getElementById('ai-checker-inline-styles')) {
      return;
    }
    
    const inlineStyles = document.createElement('style');
    inlineStyles.id = 'ai-checker-inline-styles';
    inlineStyles.textContent = `
      .ai-checker-indicator {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: white !important;
        padding: 8px 16px !important;
        border-radius: 20px !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
        border: none !important;
        min-width: 150px !important;
        text-align: center !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        z-index: 999999 !important;
        position: fixed !important;
      }
      .ai-checker-modal {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background: rgba(0, 0, 0, 0.7) !important;
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        z-index: 999999 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .ai-checker-modal-content {
        background: white !important;
        border-radius: 12px !important;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1) !important;
        max-width: 700px !important;
        width: 90% !important;
        max-height: 90% !important;
        overflow: hidden !important;
        z-index: 999999 !important;
      }
    `;
    
    document.head.appendChild(inlineStyles);
    console.log('Inline styles injected');
  }
}

// 初期化 - ポップアップウィンドウにも対応
let aiTextChecker = null;

function initializeChecker() {
  if (!aiTextChecker) {
    aiTextChecker = new AITextChecker();
    console.log('AI文章チェッカーを初期化しました');
  }
}

// 複数のタイミングで初期化を試行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChecker);
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      initializeChecker();
    }
  });
} else {
  // 既に読み込み完了の場合は即座に実行
  initializeChecker();
}

// ポップアップウィンドウの場合の追加対応
if (window.opener || window.parent !== window) {
  console.log('ポップアップウィンドウまたはフレーム内で実行中');
  
  // 少し遅らせて再度初期化を試行
  setTimeout(initializeChecker, 500);
  setTimeout(initializeChecker, 1500);
  
  // フォーカスイベントでも初期化
  window.addEventListener('focus', () => {
    setTimeout(initializeChecker, 100);
  });
}

// 動的に読み込まれた場合の対応
window.addEventListener('load', initializeChecker); 